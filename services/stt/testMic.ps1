Add-Type -AssemblyName System.Speech
try {
    $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $r.SetInputToDefaultAudioDevice()
    Write-Host "SUCCESS: Mic connected OK"
    $r.Dispose()
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
