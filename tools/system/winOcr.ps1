
param($imgPath, $resultPath)
# The search text arrives via the environment, never the command line, so quotes/$()/%VAR% in it stay inert.
$query = $env:ROCKY_OCR_QUERY
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]

# AsTask<T>(IAsyncOperation<T>) is generic, so PowerShell cannot pick it by overload resolution
# ("Cannot find an overload for AsTask") — select it by reflection and close it over the result type.
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
})[0]

function Await($WinRtTask, $ResultType) {
    $netTask = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

function Get-Center($words) {
    # Bounding-box centre of a set of OcrWord objects. Plain loop: Measure-Object cannot take
    # a scriptblock property in Windows PowerShell 5.1.
    $minX = [double]::MaxValue; $minY = [double]::MaxValue; $maxX = 0.0; $maxY = 0.0
    foreach ($w in $words) {
        $r = $w.BoundingRect
        if ($r.X -lt $minX) { $minX = $r.X }
        if ($r.Y -lt $minY) { $minY = $r.Y }
        if ($r.X + $r.Width  -gt $maxX) { $maxX = $r.X + $r.Width }
        if ($r.Y + $r.Height -gt $maxY) { $maxY = $r.Y + $r.Height }
    }
    return @{ x = [int](($minX + $maxX) / 2); y = [int](($minY + $maxY) / 2) }
}

try {
    $needle = ([string]$query).Trim().ToLowerInvariant()
    # Not named $matches: that is PowerShell's automatic variable, overwritten by every -match.
    $found = New-Object System.Collections.ArrayList

    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) { throw 'No Windows OCR engine available (install an OCR language pack).' }
    if ($needle.Length -eq 0) { throw 'Empty OCR query.' }

    $file    = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imgPath)) ([Windows.Storage.StorageFile])
    $stream  = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap  = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result  = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    # Whole-line matches first (score 1.0)
    foreach ($line in $result.Lines) {
        if ($line.Text.ToLowerInvariant().Contains($needle)) {
            $c = Get-Center $line.Words
            [void]$found.Add(@{ text = $line.Text; x = $c.x; y = $c.y; score = 1.0 })
        }
    }

    # Word-level fallback when no line matched (score 0.7)
    if ($found.Count -eq 0) {
        foreach ($line in $result.Lines) {
            foreach ($word in $line.Words) {
                if ($word.Text.ToLowerInvariant().Contains($needle)) {
                    $c = Get-Center @($word)
                    [void]$found.Add(@{ text = $word.Text; x = $c.x; y = $c.y; score = 0.7 })
                }
            }
        }
    }

    ConvertTo-Json -InputObject @($found) -Compress | Set-Content -Path $resultPath -Encoding UTF8
} catch {
    # Fail loudly: non-zero exit + stderr, so the caller can tell "engine broke" from "text not on screen".
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    [Console]::Error.WriteLine('OCR failed: ' + $e.Message)
    exit 1
}
