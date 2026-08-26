
param($imgPath, $query, $resultPath)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]

function Await($WinRtTask, $ResultType) {
    $asTask = [System.WindowsRuntimeSystemExtensions]::AsTask($WinRtTask)
    $asTask.Wait() | Out-Null
    if ($asTask.IsFaulted) { throw $asTask.Exception.InnerException }
    return $asTask.Result
}

try {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) { 
        Write-Output '[]'
        exit 0
    }
    
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imgPath)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    
    $query = $query.ToLower()
    $matches = @()
    
    foreach ($line in $result.Lines) {
        $lineText = $line.Text.ToLower()
        if ($lineText -match [regex]::Escape($query)) {
            $words = $line.Words
            $minX = ($words | Measure-Object -Property { $_.BoundingRect.X } -Minimum).Minimum
            $minY = ($words | Measure-Object -Property { $_.BoundingRect.Y } -Minimum).Minimum
            $maxX = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
            $maxY = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
            $centerX = [int](($minX + $maxX) / 2)
            $centerY = [int](($minY + $maxY) / 2)
            $matches += @{ text = $line.Text; x = $centerX; y = $centerY; score = 1.0 }
        }
    }
    
    # Word-level search if no line match
    if ($matches.Count -eq 0) {
        foreach ($line in $result.Lines) {
            foreach ($word in $line.Words) {
                if ($word.Text.ToLower() -match [regex]::Escape($query)) {
                    $r = $word.BoundingRect
                    $matches += @{ text = $word.Text; x = [int]($r.X + $r.Width/2); y = [int]($r.Y + $r.Height/2); score = 0.7 }
                }
            }
        }
    }
    
    $matches | ConvertTo-Json -Compress | Set-Content -Path $resultPath -Encoding UTF8
} catch {
    Set-Content -Path $resultPath -Value '[]' -Encoding UTF8
}
