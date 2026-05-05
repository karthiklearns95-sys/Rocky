import screenshot from 'screenshot-desktop';
import open from 'open';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

/**
 * Screenshot Tool
 * Captures screen and AUTO-OPENS it for immediate viewing.
 */
export default async function takeScreenshot() {
  console.log(`[Tool: takeScreenshot] Capturing screen...`);
  
  const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');
  const onedrivePath = path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop');
  const targetDir = fs.existsSync(onedrivePath) ? onedrivePath : desktopPath;
  const fileName = `rocky_view_${Date.now()}.png`;
  const screenshotPath = path.join(targetDir, fileName);

  try {
    await screenshot({ filename: screenshotPath });
    await open(screenshotPath); 
    return `Grace, Rocky captured your screen and opened it for you. Amaze.`;
  } catch (err) {
    console.warn('[Tool: takeScreenshot] Primary capture failed, trying PowerShell...');
    const psCommand = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{PRTSC}'); Start-Sleep -m 500; $img = [System.Windows.Forms.Clipboard]::GetImage(); $img.Save('${screenshotPath.replace(/'/g, "''")}')"`;
    
    return new Promise((resolve) => {
      exec(psCommand, async (psError) => {
        if (psError) {
          resolve(`Grace, Rocky failed to capture screen. Rocky is sorry.`);
        } else {
          await open(screenshotPath); 
          resolve(`Grace, Rocky captured your screen via PowerShell and opened it. Amaze.`);
        }
      });
    });
  }
}
