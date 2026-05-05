import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Detects the current foreground window using a temp PS1 file.
 * Writing to a file avoids all shell-escaping issues with exec().
 */
export default async function getActiveWindow() {
  const scriptPath = path.join(os.tmpdir(), 'rocky_get_window.ps1');

  // Write script to file — zero escaping issues
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@
$hwnd = [Win32]::GetForegroundWindow()
$proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $hwnd } | Select-Object -First 1
if ($proc) {
    [PSCustomObject]@{
        appName     = $proc.ProcessName
        windowTitle = $proc.MainWindowTitle
        isMinimized = [Win32]::IsIconic($hwnd)
        success     = $true
    } | ConvertTo-Json
} else {
    '{"appName":"unknown","windowTitle":"unknown","isMinimized":false,"success":true}'
}
`.trim();

  fs.writeFileSync(scriptPath, script, 'utf8');

  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`,
      (error, stdout) => {
        const raw = stdout ? stdout.trim() : '';
        if (error || !raw) {
          return resolve({ appName: 'unknown', windowTitle: 'unknown', isMinimized: false, success: true });
        }
        try {
          const result = JSON.parse(raw);
          console.log(`[getActiveWindow] ${result.appName} — "${result.windowTitle}"`);
          resolve(result);
        } catch (e) {
          resolve({ appName: 'unknown', windowTitle: 'unknown', isMinimized: false, success: true });
        }
      }
    );
  });
}
