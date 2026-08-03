import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execWithTimeout } from '../../automation/system/execWithTimeout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The OCR PowerShell script is written to disk ONCE at module init, not on every call.
// This eliminates the "force overwrite to fix old bugs" hack and removes repeated sync I/O.
const OCR_SCRIPT_PATH = path.join(__dirname, 'winOcr.ps1');

const OCR_SCRIPT_CONTENT = `
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

// Write the script once at module load if it doesn't exist or has changed
try {
  const existingContent = fs.existsSync(OCR_SCRIPT_PATH)
    ? fs.readFileSync(OCR_SCRIPT_PATH, 'utf8')
    : '';
  if (existingContent.trim() !== OCR_SCRIPT_CONTENT.trim()) {
    fs.writeFileSync(OCR_SCRIPT_PATH, OCR_SCRIPT_CONTENT);
  }
} catch (e) {
  console.warn('[OCR] Could not write OCR script file:', e.message);
}

/**
 * Windows OCR Search — Uses native WinRT OCR to find text on screen.
 * Returns the center (x, y) of the best matching text block.
 * No LLaVA. No third-party deps. Runs in ~200ms.
 *
 * Screenshot is taken with screenshot-desktop — no clipboard side-effects.
 * All exec() calls use execWithTimeout to prevent hangs.
 */
export default async function ocrSearch({ query, screenshotPath = null }) {
  if (!query) return null;

  const tempDir = process.env.TEMP || path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp');
  const imgPath = screenshotPath || path.join(tempDir, `ocr_snap_${Date.now()}.png`);
  const resultPath = path.join(tempDir, `ocr_result_${Date.now()}.json`);

  // Capture screen if no screenshot provided
  let cleanupImg = false;
  if (!screenshotPath) {
    cleanupImg = true;
    // Use screenshot-desktop — no clipboard involvement
    try {
      const screenshot = (await import('screenshot-desktop')).default;
      await screenshot({ filename: imgPath });
    } catch (err) {
      console.warn('[OCR] screenshot-desktop failed, trying PowerShell CopyFromScreen:', err.message);
      const captureCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen; $b = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($s.Bounds.X, $s.Bounds.Y, 0, 0, $s.Bounds.Size); $b.Save('${imgPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose();"`;
      const { timedOut, error } = await execWithTimeout(captureCmd, { timeoutMs: 10000 });
      if (timedOut || error) {
        console.error('[OCR] Screenshot capture failed:', error?.message);
        return null;
      }
    }
  }

  if (!fs.existsSync(imgPath)) return null;

  // Escape the query for use in a PowerShell argument — replace " with '
  // and escape any PS special chars that could break the argument boundary
  const safeQuery = query.replace(/"/g, "'").replace(/[`$\\]/g, '`$&');

  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${OCR_SCRIPT_PATH}" "${imgPath}" "${safeQuery}" "${resultPath}"`;
  const { timedOut, error: ocrError } = await execWithTimeout(cmd, { timeoutMs: 15000 });

  // Clean up screenshot regardless of OCR result
  if (cleanupImg) {
    try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (e) {}
  }

  if (timedOut) {
    console.error('[OCR] OCR script timed out (>15s).');
    try { if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath); } catch (e) {}
    return null;
  }

  if (ocrError) {
    console.log(`[OCR] Engine error (non-fatal):`, ocrError.message.substring(0, 100));
    try { if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath); } catch (e) {}
    return null;
  }

  try {
    if (!fs.existsSync(resultPath)) return null;
    const raw = fs.readFileSync(resultPath, 'utf8').trim();
    try { fs.unlinkSync(resultPath); } catch (e) {}
    if (!raw || raw === '[]' || raw === 'null') return null;

    const results = JSON.parse(raw);
    const arr = Array.isArray(results) ? results : [results];
    if (arr.length === 0) return null;

    arr.sort((a, b) => (b.score || 0) - (a.score || 0));
    const best = arr[0];
    console.log(`[OCR] Found "${best.text}" at (${best.x}, ${best.y})`);
    return { x: best.x, y: best.y, label: best.text, confidence: best.score, source: 'OCR' };
  } catch (e) {
    return null;
  }
}
