import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execWithTimeout } from '../../automation/system/execWithTimeout.js';
import { tryWorker } from '../../automation/system/psWorker.js';
import { cachedReader } from './screenCache.js';
import { matchOcrLines } from './elementMatcher.js';
import { loadDisplays, activeDisplay } from '../../automation/system/displays.js';
import getActiveWindow from '../../automation/system/getActiveWindow.js';
import getSystemMetrics from '../../automation/system/getSystemMetrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The OCR PowerShell script is written to disk ONCE at module init, not on every call.
// This eliminates the "force overwrite to fix old bugs" hack and removes repeated sync I/O.
const OCR_SCRIPT_PATH = path.join(__dirname, 'winOcr.ps1');

const OCR_SCRIPT_CONTENT = `
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
// Fast path: the persistent worker captures a display and reads it in memory (no temp files,
// engine already loaded). Returns that display's recognised lines in virtual-desktop pixels, or
// null if it cannot. The result is shared for a moment, so several lookups read each display once.
const readDisplayLines = cachedReader(async (rect) => {
  const fast = await tryWorker('ocr', rect, { timeoutMs: 12000 });
  return fast.ok && Array.isArray(fast.result) ? fast.result : null;
}, { ttlMs: 1500, shouldCache: Array.isArray });

/** Displays to read, the one Grace is working on first. Null when displays cannot be listed. */
async function displaysToRead() {
  const displays = await loadDisplays({ fallback: getSystemMetrics }).catch(() => null);
  if (!displays?.length) return null;
  const win = await getActiveWindow().catch(() => null);
  const first = activeDisplay(displays, { activeWindow: win?.bounds || null });
  return first ? [first, ...displays.filter((d) => d !== first)] : displays;
}

export default async function ocrSearch({ query, screenshotPath = null }) {
  if (!query) return null;

  if (!screenshotPath) {
    const targets = await displaysToRead();
    let readAny = false;
    for (const d of targets || [null]) {
      const rect = d ? { x: d.x, y: d.y, width: d.width, height: d.height } : {};
      const lines = await readDisplayLines(JSON.stringify(rect), rect);
      if (!lines) continue;
      readAny = true;
      const best = matchOcrLines(lines, query);
      if (best) {
        console.log(`[OCR] Found "${best.text}" at (${best.x}, ${best.y})`);
        return { x: best.x, y: best.y, label: best.text, confidence: best.score, source: 'OCR' };
      }
    }
    if (readAny) return null; // the screen(s) were read fine; the text just is not there
    // worker could not read the screen: fall through to the one-shot script below
  }

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

  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${OCR_SCRIPT_PATH}" "${imgPath}" "${resultPath}"`;
  const { timedOut, error: ocrError, stderr: ocrStderr } = await execWithTimeout(cmd, {
    timeoutMs: 15000,
    env: { ROCKY_OCR_QUERY: String(query) },
  });

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
    console.warn('[OCR] Engine error (non-fatal):', (ocrStderr || ocrError.message).trim().substring(0, 300));
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
