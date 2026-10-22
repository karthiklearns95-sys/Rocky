# Rocky native voice-activity process.
#
# Uses Windows' built-in speech recognition as a voice-activity detector: every utterance it hears
# (recognised or not) is saved as a WAV file for Whisper to transcribe. Talks to Rocky on stdout
# using one line per message (see vadProtocol.js):
#
#   [READY]                microphone is open and listening
#   [HEARTBEAT]            still alive (every 5 seconds); Rocky restarts this process if they stop
#   [STOP]                 a stop word was heard: act immediately
#   [AUDIO] <file name>    an utterance was saved as <file name> inside -OutDir
#   [DEVICE] <name>        which microphone it is listening to (sent once, after [READY])
#   [DEVICE_CHANGED] <name> Windows' default microphone changed (headset plugged in or removed);
#                          this script exits right after so Rocky restarts it on the new device
#   [ERROR] <code> <text>  it cannot work; `no_microphone` means no usable input device
#
# Rocky starts it again if it exits or goes quiet (vadSupervisor.js), so on a fatal problem this
# script reports the reason and exits instead of limping on.

param(
    [string]$OutDir = (Join-Path $env:TEMP 'rocky_voice')
)

$ErrorActionPreference = 'Stop'

function Write-Line($text) {
    [Console]::Out.WriteLine($text)
    [Console]::Out.Flush()
}

try {
    Add-Type -AssemblyName System.Speech
} catch {
    Write-Line ('[ERROR] no_speech_engine ' + ($_.Exception.Message -replace '\s+', ' '))
    exit 3
}

try {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
} catch {
    Write-Line ('[ERROR] no_output_folder ' + ($_.Exception.Message -replace '\s+', ' '))
    exit 3
}

# -- Which microphone is Windows' default? (Core Audio, best effort) ---------
# SetInputToDefaultAudioDevice binds to the default microphone ONCE. When the default changes later
# (headset plugged in, USB mic removed) the recogniser keeps listening to the old device, so Rocky
# would go deaf or hear the wrong microphone. Ask Windows for the default's id now, ask again every
# couple of seconds, and report the change; Rocky then restarts this script on the new device.
$global:RockyMicWatch = $false
try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class RockyAudio {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] private class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore props);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid fmtid; public int pid; }

    // Large enough for the 24-byte PROPVARIANT on 64-bit Windows.
    [StructLayout(LayoutKind.Explicit)]
    private struct PropVariant {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointer;
        [FieldOffset(16)] public IntPtr reserved;
    }

    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);

    private const int E_NOTFOUND = unchecked((int)0x80070490);

    private static IMMDevice DefaultCapture() {
        IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice device;
        int hr = enumerator.GetDefaultAudioEndpoint(1, 0, out device);   // eCapture, eConsole
        if (hr == E_NOTFOUND) return null;
        Marshal.ThrowExceptionForHR(hr);
        return device;
    }

    // Id of the default microphone; "" when Windows has none; throws if Windows cannot be asked.
    public static string DefaultCaptureId() {
        IMMDevice device = DefaultCapture();
        if (device == null) return "";
        string id;
        Marshal.ThrowExceptionForHR(device.GetId(out id));
        return id;
    }

    // Friendly name of the default microphone; "" if unknown. Never throws.
    public static string DefaultCaptureName() {
        try {
            IMMDevice device = DefaultCapture();
            if (device == null) return "";
            IPropertyStore store;
            if (device.OpenPropertyStore(0, out store) != 0) return "";
            PropertyKey key = new PropertyKey();
            key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");   // PKEY_Device_FriendlyName
            key.pid = 14;
            PropVariant value;
            if (store.GetValue(ref key, out value) != 0) return "";
            try { return value.vt == 31 ? (Marshal.PtrToStringUni(value.pointer) ?? "") : ""; }
            finally { PropVariantClear(ref value); }
        } catch (Exception) { return ""; }
    }
}
"@
    $global:RockyMicWatch = $true
} catch {
    # Without it Rocky still works; he just cannot notice a changed default microphone.
    $global:RockyMicWatch = $false
}

function Get-DefaultMicId {
    if (-not $global:RockyMicWatch) { return $null }
    try { return [RockyAudio]::DefaultCaptureId() } catch { return $null }
}

function Get-DefaultMicName {
    if (-not $global:RockyMicWatch) { return '' }
    try { return ([RockyAudio]::DefaultCaptureName() -replace '[^\x20-\x7E]', '' -replace '\s+', ' ').Trim() } catch { return '' }
}

# Event actions run in their own scope and cannot see script-level variables: share through $global:.
$global:RockyOutDir = $OutDir
$global:RockyCounter = 0

# The default microphone BEFORE binding: if it changes while the recogniser is opening, the first poll notices.
$global:RockyMicId = Get-DefaultMicId

try {
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $recognizer.SetInputToDefaultAudioDevice()
} catch {
    # No input device, or the default one cannot be opened (muted/blocked in Windows privacy settings).
    Write-Line ('[ERROR] no_microphone ' + ($_.Exception.Message -replace '\s+', ' '))
    exit 2
}

try {
    # Dramatically reduce silence timeouts so it flushes immediately when speaking stops
    $recognizer.BabbleTimeout = [TimeSpan]::FromMilliseconds(500)
    $recognizer.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(500)
    $recognizer.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(500)

    # Dictation Grammar captures EVERYTHING (including wake words)
    $dictation = New-Object System.Speech.Recognition.DictationGrammar
    $recognizer.LoadGrammar($dictation)
} catch {
    Write-Line ('[ERROR] speech_engine ' + ($_.Exception.Message -replace '\s+', ' '))
    exit 3
}

$global:RockyHandleSpeech = {
    param($result)
    $text = $result.Text.ToLower()
    $audio = $result.Audio

    if ($null -ne $audio) {
        # Check for stopword for immediate interrupt
        if ($text -match "\b(stop|cancel|wait|nevermind|halt)\b") {
            Write-Line "[STOP]"
            return
        }

        # Unique, ASCII-only file names: no collisions between rapid commands or across restarts, and
        # the name travels over stdout without any code-page trouble (user names can contain accents).
        $global:RockyCounter++
        $name = 'utt-' + [DateTime]::UtcNow.Ticks + '-' + $global:RockyCounter + '.wav'
        $path = Join-Path $global:RockyOutDir $name

        # Always save audio and let Whisper figure out if the wake word was spoken
        $stream = $null
        try {
            $stream = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Create)
            $audio.WriteToWaveStream($stream)
        } finally {
            if ($null -ne $stream) { $stream.Close() }
        }
        Write-Line ('[AUDIO] ' + $name)
    }
}

Register-ObjectEvent -InputObject $recognizer -EventName "SpeechRecognized" -Action {
    & $global:RockyHandleSpeech $event.SourceEventArgs.Result
} | Out-Null

Register-ObjectEvent -InputObject $recognizer -EventName "SpeechRecognitionRejected" -Action {
    # Even if native engine rejects it as gibberish, save the audio for Whisper!
    if ($null -ne $event.SourceEventArgs.Result.Audio) {
        & $global:RockyHandleSpeech $event.SourceEventArgs.Result
    }
} | Out-Null

try {
    $recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
} catch {
    Write-Line ('[ERROR] speech_engine ' + ($_.Exception.Message -replace '\s+', ' '))
    exit 3
}

Write-Line "[READY]"
Write-Line ('[DEVICE] ' + (Get-DefaultMicName))

$ticks = 0
while ($true) {
    Start-Sleep -Milliseconds 500
    $ticks++
    if ($ticks % 10 -eq 0) { Write-Line "[HEARTBEAT]" }

    # Every 2 seconds: is Windows' default microphone still the one we are listening to?
    if ($ticks % 4 -eq 0 -and $null -ne $global:RockyMicId) {
        $now = Get-DefaultMicId
        if ($null -ne $now -and $now -ne $global:RockyMicId) {
            $name = Get-DefaultMicName
            if ($name.Length -eq 0) { $name = 'none' }
            Write-Line ('[DEVICE_CHANGED] ' + $name)
            exit 0
        }
    }
}
