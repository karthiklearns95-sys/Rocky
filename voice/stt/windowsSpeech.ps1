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

# Event actions run in their own scope and cannot see script-level variables: share through $global:.
$global:RockyOutDir = $OutDir
$global:RockyCounter = 0

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

$ticks = 0
while ($true) {
    Start-Sleep -Milliseconds 500
    $ticks++
    if ($ticks % 10 -eq 0) { Write-Line "[HEARTBEAT]" }
}
