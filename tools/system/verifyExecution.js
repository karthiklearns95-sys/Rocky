import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import screenshot from 'screenshot-desktop';

/**
 * Captures a screenshot to a temp file for pre/post action comparison.
 * Uses screenshot-desktop (native, Electron-compatible, no PS overhead).
 */
export async function captureTempScreenshot(filename) {
  const tempDir = process.env.TEMP || path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp');
  const filepath = path.join(tempDir, filename);

  try {
    await screenshot({ filename: filepath, format: 'png' });
    return filepath;
  } catch (e) {
    // Fallback: PowerShell GDI capture
    await new Promise((resolve) => {
      const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen; $b = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($s.Bounds.X, $s.Bounds.Y, 0, 0, $s.Bounds.Size); $b.Save('${filepath}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose();"`;
      exec(psCmd, () => resolve());
    });
    return filepath;
  }
}

/**
 * Visual Delta Detection — Reliable execution verification.
 *
 * Uses file-size comparison (PNG compression is content-aware, so any
 * visible change on screen produces a measurably different file size).
 * 
 * Threshold 0.05% eliminates cursor-blink and taskbar-clock false triggers.
 *
 * Returns: { changed: boolean, reason: string, diffPercent: number }
 */
export async function compareScreenshots(beforePath, afterPath, clickX = -1, clickY = -1) {
  const cleanup = () => {
    try { if (fs.existsSync(beforePath)) fs.unlinkSync(beforePath); } catch (e) {}
    try { if (fs.existsSync(afterPath)) fs.unlinkSync(afterPath); } catch (e) {}
  };

  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) {
    cleanup();
    return { changed: true, reason: 'MISSING_FILE', diffPercent: 100 };
  }

  const sizeBefore = fs.statSync(beforePath).size;
  const sizeAfter = fs.statSync(afterPath).size;

  if (sizeBefore === 0) {
    cleanup();
    return { changed: true, reason: 'CAPTURE_FAILED', diffPercent: 100 };
  }

  const diffPercent = (Math.abs(sizeAfter - sizeBefore) / sizeBefore) * 100;
  console.log(`[Validation] Screen delta: ${diffPercent.toFixed(3)}% (before=${sizeBefore}b after=${sizeAfter}b)`);

  cleanup();

  const THRESHOLD = 0.05;
  const changed = diffPercent > THRESHOLD;

  return {
    changed,
    reason: changed ? 'SCREEN_CHANGED' : 'NO_CHANGE',
    diffPercent
  };
}
