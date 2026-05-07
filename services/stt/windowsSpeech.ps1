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
        $index = $text.IndexOf("rocky")
        if ($index -ge 0) {
            [Console]::WriteLine("[WAKE]")
            $remainder = $text.Substring($index + 5).Trim()
            if ($remainder.Length -gt 0) {
                # Command spoken in the same breath as wake word
                [Console]::WriteLine("[COMMAND] $remainder")
                $global:isWoken = $false
            } else {
                $global:isWoken = $true
            }
        }
    } else {
        if ($text.Trim() -ne "") {
            [Console]::WriteLine("[COMMAND] $text")
            $global:isWoken = $false
        }
    }
} | Out-Null

[Console]::WriteLine("[READY]")

$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

# Keep the script alive
while ($true) {
    Start-Sleep -Milliseconds 500
}
