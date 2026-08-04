import fs from 'fs';
import os from 'os';
import path from 'path';
import { execWithTimeout } from '../../automation/system/execWithTimeout.js';

function psSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

function normalizeElement(element) {
  const x = Number(element?.x);
  const y = Number(element?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    label:  String(element.label || element.name || 'element'),
    x:      Math.round(x),
    y:      Math.round(y),
    width:  Math.max(0, Math.round(Number(element.width)  || 0)),
    height: Math.max(0, Math.round(Number(element.height) || 0))
  };
}

/**
 * Captures pixel color samples at UI element coordinates for visual signature matching.
 *
 * Fixed: replaced callback-style bare exec() with execWithTimeout (10s deadline).
 * The CopyFromScreen PowerShell script reads the GPU framebuffer — on some systems
 * this stalls (e.g., hardware-accelerated windows, RDP sessions). Without a timeout
 * the UIMapCoordinator validation loop blocked indefinitely.
 */
export async function captureUIVisualSignature(elements = []) {
  const usableElements = elements
    .map(normalizeElement)
    .filter(Boolean)
    .slice(0, 24);

  if (usableElements.length === 0) return null;

  const stamp       = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const payloadPath = path.join(os.tmpdir(), `rocky_ui_signature_${stamp}.json`);
  const scriptPath  = path.join(os.tmpdir(), `rocky_ui_signature_${stamp}.ps1`);

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
        label   = $el.label
        samples = $samples
    }
}

$graphics.Dispose()
$bitmap.Dispose()
$result | ConvertTo-Json -Depth 6
`.trim();

  fs.writeFileSync(scriptPath, script, 'utf8');

  const { stdout, timedOut } = await execWithTimeout(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`,
    { timeoutMs: 10000, encoding: 'utf8' }
  );

  // Always clean up temp files
  try { fs.unlinkSync(payloadPath); } catch { /* ignore */ }
  try { fs.unlinkSync(scriptPath);  } catch { /* ignore */ }

  if (timedOut || !stdout) return null;

  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}
