Add-Type -AssemblyName System.Speech

$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()

# Explicit Wake Word Grammar for high accuracy
$choices = New-Object System.Speech.Recognition.Choices
$choices.Add("rocky")
$choices.Add("hey rocky")
$choices.Add("okay rocky")
$choices.Add("hello rocky")

$builder = New-Object System.Speech.Recognition.GrammarBuilder
$builder.Append($choices)
$wakeGrammar = New-Object System.Speech.Recognition.Grammar($builder)
$recognizer.LoadGrammar($wakeGrammar)

# Dictation Grammar for general commands
$dictation = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($dictation)

$global:isWoken = $false

Register-ObjectEvent -InputObject $recognizer -EventName "SpeechRecognized" -Action {
    $text = $event.SourceEventArgs.Result.Text.ToLower()
    
    if (-not $global:isWoken) {
        if ($text -match "rocky") {
            $global:isWoken = $true
            Write-Output "[WAKE]"
        }
    } else {
        if ($text.Trim() -ne "") {
            Write-Output "[COMMAND] $text"
            $global:isWoken = $false
        }
    }
} | Out-Null

Write-Output "[READY]"

$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

# Keep the script alive
while ($true) {
    Start-Sleep -Milliseconds 500
}
