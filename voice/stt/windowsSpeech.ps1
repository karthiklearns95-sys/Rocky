Add-Type -AssemblyName System.Speech

$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()

# Dramatically reduce silence timeouts so it flushes immediately when speaking stops
$recognizer.BabbleTimeout = [TimeSpan]::FromMilliseconds(500)
$recognizer.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(500)
$recognizer.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(500)

# Dictation Grammar captures EVERYTHING (including wake words)
$dictation = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($dictation)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$tempBase = Join-Path $scriptDir "temp_cmd"
$global:cmdCounter = 0

$global:isWoken = $false

$handleSpeech = {
    param($result)
    $text = $result.Text.ToLower()
    $audio = $result.Audio
    
    if ($null -ne $audio) {
        # Check for stopword for immediate interrupt
        if ($text -match "\b(stop|cancel|wait|nevermind|halt)\b") {
            [Console]::WriteLine("[STOP]")
            return
        }

        # Use unique filenames to prevent race conditions on rapid commands
        $global:cmdCounter++
        $tempWav = "$tempBase-$($global:cmdCounter).wav"

        if (-not $global:isWoken) {
            $index = $text.IndexOf("rocky")
            if ($index -ge 0) {
                [Console]::WriteLine("[WAKE]")
                $remainder = $text.Substring($index + 5).Trim()
                if ($remainder.Length -gt 0) {
                    # Save audio of the whole phrase
                    $stream = New-Object System.IO.FileStream($tempWav, [System.IO.FileMode]::Create)
                    $audio.WriteToWaveStream($stream)
                    $stream.Close()
                    [Console]::WriteLine("[AUDIO] $tempWav")
                    $global:isWoken = $false
                } else {
                    $global:isWoken = $true
                }
            }
        } else {
            # We are woken, capture the command audio
            $stream = New-Object System.IO.FileStream($tempWav, [System.IO.FileMode]::Create)
            $audio.WriteToWaveStream($stream)
            $stream.Close()
            [Console]::WriteLine("[AUDIO] $tempWav")
            $global:isWoken = $false
        }
    }
}

Register-ObjectEvent -InputObject $recognizer -EventName "SpeechRecognized" -Action {
    & $handleSpeech $event.SourceEventArgs.Result
} | Out-Null

Register-ObjectEvent -InputObject $recognizer -EventName "SpeechRecognitionRejected" -Action {
    # Even if native engine rejects it as gibberish, if we are woken, save the audio for Whisper!
    if ($global:isWoken -and $null -ne $event.SourceEventArgs.Result.Audio) {
        & $handleSpeech $event.SourceEventArgs.Result
    }
} | Out-Null

[Console]::WriteLine("[READY]")

$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

while ($true) {
    Start-Sleep -Milliseconds 500
}
