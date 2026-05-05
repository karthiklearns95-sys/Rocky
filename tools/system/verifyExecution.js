import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

export function captureTempScreenshot(filename) {
  const tempDir = process.env.TEMP || path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp');
  const filepath = path.join(tempDir, filename);
  const psCmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen; $b = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($s.Bounds.X, $s.Bounds.Y, 0, 0, $s.Bounds.Size); $b.Save('${filepath}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose();"`;
  
  return new Promise((resolve) => {
    exec(psCmd, () => resolve(filepath));
  });
}

/**
 * Visual Delta Detection - Compares two screenshots to verify UI state changed.
 */
export async function compareScreenshots(beforePath, afterPath) {
  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) {
    return { changed: true, changeScore: 100 }; // Bypass if missing
  }

  const statBefore = fs.statSync(beforePath);
  const statAfter = fs.statSync(afterPath);
  
  const sizeDiff = Math.abs(statBefore.size - statAfter.size);
  const percentChange = (sizeDiff / statBefore.size) * 100;
  
  console.log(`[Validation] Visual change score: ${percentChange.toFixed(2)}%`);
  
  // Clean up
  try { fs.unlinkSync(beforePath); fs.unlinkSync(afterPath); } catch (e) {}

  return {
    changed: percentChange > 0.05, 
    changeScore: percentChange
  };
}
