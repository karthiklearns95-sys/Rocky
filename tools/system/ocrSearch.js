import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Windows OCR Search — Uses native WinRT OCR to find text on screen.
 * Returns the center (x, y) of the best matching text block.
 * No LLaVA. No third-party deps. Runs in ~200ms.
 */
export default async function ocrSearch({ query, screenshotPath = null }) {
  if (!query) return null;

  const tempDir = process.env.TEMP || path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp');
  const imgPath = screenshotPath || path.join(tempDir, `ocr_snap_${Date.now()}.png`);
  const resultPath = path.join(tempDir, `ocr_result_${Date.now()}.json`);
  const scriptPath = path.join(__dirname, 'winOcr.ps1');

  // Write the OCR PowerShell script (force overwrite to fix old bugs)
  const script = `
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
`;
  fs.writeFileSync(scriptPath, script);

  // Capture screen if no screenshot provided
  let cleanupImg = false;
  if (!screenshotPath) {
    cleanupImg = true;
    await new Promise((resolve) => {
      const captureCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen; $b = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($s.Bounds.X, $s.Bounds.Y, 0, 0, $s.Bounds.Size); $b.Save('${imgPath}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose();"`;
      exec(captureCmd, () => resolve());
    });
  }

  return new Promise((resolve) => {
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" "${imgPath}" "${query.replace(/"/g, "'")}" "${resultPath}"`;
    exec(cmd, (error) => {
      try {
        if (cleanupImg && fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
      } catch (e) {}

      if (error) {
        console.log(`[OCR] Engine error (non-fatal):`, error.message.substring(0, 100));
        if (fs.existsSync(resultPath)) try { fs.unlinkSync(resultPath); } catch(e) {}
        return resolve(null);
      }

      try {
        if (!fs.existsSync(resultPath)) return resolve(null);
        const raw = fs.readFileSync(resultPath, 'utf8').trim();
        if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
        if (!raw || raw === '[]' || raw === 'null') return resolve(null);

        const results = JSON.parse(raw);
        const arr = Array.isArray(results) ? results : [results];
        if (arr.length === 0) return resolve(null);

        // Return the highest-score match
        arr.sort((a, b) => (b.score || 0) - (a.score || 0));
        const best = arr[0];
        console.log(`[OCR] Found "${best.text}" at (${best.x}, ${best.y})`);
        resolve({ x: best.x, y: best.y, label: best.text, confidence: best.score, source: 'OCR' });
      } catch (e) {
        resolve(null);
      }
    });
  });
}
