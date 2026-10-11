# Downloads the Piper TTS Windows binary and the en_US-lessac-medium voice into <repo>/bin/piper.
# Rocky's TTS (voice/tts/textToSpeech.js) expects piper.exe and the .onnx model at that location.
#
# Usage (from anywhere):  powershell -ExecutionPolicy Bypass -File scripts\install_piper.ps1
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BinDir   = Join-Path $RepoRoot 'bin'
$PiperDir = Join-Path $BinDir 'piper'

if (-Not (Test-Path $PiperDir)) {
    New-Item -ItemType Directory -Path $PiperDir -Force | Out-Null
}

$ZipPath  = Join-Path $BinDir 'piper.zip'
$PiperUrl = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip'

Write-Host 'Downloading Piper TTS Windows binary...'
Invoke-WebRequest -Uri $PiperUrl -OutFile $ZipPath

Write-Host 'Extracting Piper TTS...'
# The archive contains a top-level "piper" folder, so extracting into bin/ yields bin/piper/piper.exe.
Expand-Archive -Path $ZipPath -DestinationPath $BinDir -Force

$VoiceBase = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium'

Write-Host 'Downloading en_US-lessac-medium.onnx voice model...'
Invoke-WebRequest -Uri "$VoiceBase/en_US-lessac-medium.onnx" -OutFile (Join-Path $PiperDir 'en_US-lessac-medium.onnx')

Write-Host 'Downloading en_US-lessac-medium.onnx.json config...'
Invoke-WebRequest -Uri "$VoiceBase/en_US-lessac-medium.onnx.json" -OutFile (Join-Path $PiperDir 'en_US-lessac-medium.onnx.json')

Write-Host 'Cleaning up zip file...'
Remove-Item -Path $ZipPath -Force

if (-Not (Test-Path (Join-Path $PiperDir 'piper.exe'))) {
    throw "Install finished but $PiperDir\piper.exe is missing - the archive layout may have changed."
}
Write-Host "Piper TTS installation complete: $PiperDir"
