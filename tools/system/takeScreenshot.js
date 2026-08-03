import screenshot from 'screenshot-desktop';
import open from 'open';
import path from 'path';
import fs from 'fs';
import { execWithTimeout } from '../../automation/system/execWithTimeout.js';

/**
 * Screenshot Tool
 * Captures the primary screen and opens the file for immediate viewing.
 *
 * Primary path: screenshot-desktop — no clipboard involvement.
 * Fallback: PowerShell CopyFromScreen (NOT the clipboard SendKeys hack).
 * Both paths use execWithTimeout to prevent indefinite hangs.
 */
export default async function takeScreenshot() {
  console.log(`[Tool: takeScreenshot] Capturing screen...`);

  const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');
  const onedrivePath = path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop');
  const targetDir = fs.existsSync(onedrivePath) ? onedrivePath : desktopPath;
  const fileName = `rocky_view_${Date.now()}.png`;
  const screenshotPath = path.join(targetDir, fileName);

  // ── Primary: screenshot-desktop ──────────────────────────────────────
  // No clipboard, no SendKeys, no side-effects.
  try {
    await screenshot({ filename: screenshotPath });
    await open(screenshotPath);
    return `Rocky captured your screen and opened it for you.`;
  } catch (err) {
    console.warn('[Tool: takeScreenshot] screenshot-desktop failed, trying PowerShell CopyFromScreen...');
  }

  // ── Fallback: PowerShell CopyFromScreen (NOT the clipboard hack) ──────
  // Uses Graphics.CopyFromScreen which reads directly from the display framebuffer.
  // Does NOT touch the clipboard. Has a 12-second hard timeout.
  const safeTarget = screenshotPath.replace(/'/g, "''");
  const psCommand = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen; $b = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($s.Bounds.X, $s.Bounds.Y, 0, 0, $s.Bounds.Size); $b.Save('${safeTarget}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose();"`;

  const { timedOut, error } = await execWithTimeout(psCommand, { timeoutMs: 12000 });

  if (timedOut) {
    return `Rocky's screenshot timed out. The display driver may be busy.`;
  }
  if (error) {
    return `Rocky failed to capture the screen: ${error.message}`;
  }

  if (fs.existsSync(screenshotPath)) {
    await open(screenshotPath);
    return `Rocky captured your screen and opened it for you.`;
  }

  return `Rocky could not save the screenshot file.`;
}
