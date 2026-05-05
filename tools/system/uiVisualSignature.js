import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';

function psSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

function normalizeElement(element) {
  const x = Number(element?.x);
  const y = Number(element?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    label: String(element.label || element.name || 'element'),
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(0, Math.round(Number(element.width) || 0)),
    height: Math.max(0, Math.round(Number(element.height) || 0))
  };
}

export function captureUIVisualSignature(elements = []) {
  const usableElements = elements
    .map(normalizeElement)
    .filter(Boolean)
    .slice(0, 24);

  if (usableElements.length === 0) return Promise.resolve(null);

  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const payloadPath = path.join(os.tmpdir(), `rocky_ui_signature_${stamp}.json`);
  const scriptPath = path.join(os.tmpdir(), `rocky_ui_signature_${stamp}.ps1`);

  fs.writeFileSync(payloadPath, JSON.stringify(usableElements), 'utf8');

  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$payloadPath = '${psSingleQuote(payloadPath)}'
$elements = @(Get-Content -Raw -LiteralPath $payloadPath | ConvertFrom-Json)
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)

$result = @()
foreach ($el in $elements) {
    $halfW = [Math]::Max(1, [double]$el.width / 4)
    $halfH = [Math]::Max(1, [double]$el.height / 4)
    $points = @(
        @{ x = [double]$el.x; y = [double]$el.y },
        @{ x = [double]$el.x - $halfW; y = [double]$el.y },
        @{ x = [double]$el.x + $halfW; y = [double]$el.y },
        @{ x = [double]$el.x; y = [double]$el.y - $halfH },
        @{ x = [double]$el.x; y = [double]$el.y + $halfH }
    )

    $samples = @()
    foreach ($point in $points) {
        $screenX = [Math]::Min([Math]::Max([int][Math]::Round($point.x), $bounds.Left), $bounds.Right - 1)
        $screenY = [Math]::Min([Math]::Max([int][Math]::Round($point.y), $bounds.Top), $bounds.Bottom - 1)
        $bitmapX = $screenX - $bounds.X
        $bitmapY = $screenY - $bounds.Y
        $color = $bitmap.GetPixel($bitmapX, $bitmapY)
        $samples += [PSCustomObject]@{ r = $color.R; g = $color.G; b = $color.B }
    }

    $result += [PSCustomObject]@{
        label = $el.label
        samples = $samples
    }
}

$graphics.Dispose()
$bitmap.Dispose()
$result | ConvertTo-Json -Depth 6
`.trim();

  fs.writeFileSync(scriptPath, script, 'utf8');

  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        try { fs.unlinkSync(payloadPath); } catch { /* ignore cleanup failure */ }
        try { fs.unlinkSync(scriptPath); } catch { /* ignore cleanup failure */ }

        if (error || !stdout) return resolve(null);

        try {
          const parsed = JSON.parse(stdout);
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
          resolve(null);
        }
      }
    );
  });
}
