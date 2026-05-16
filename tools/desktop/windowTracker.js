import { exec } from 'child_process';
import { desktopSession } from './desktopSessionStore.js';

/**
 * windowTracker.js
 * 
 * Tracks active windows, foreground HWND, and restores minimized apps natively.
 */
export async function restoreAndFocusWindow(appName) {
  const safeName = String(appName).replace(/'/g, "''");
  
  // Advanced PowerShell to find by name, restore if minimized (ShowWindow), and bring to front
  const psCommand = `powershell -Command "
$proc = Get-Process | Where-Object { $_.MainWindowTitle -match '${safeName}' -or $_.Name -match '${safeName}' } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
    $sig = '[DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'
    $t = Add-Type -MemberDefinition $sig -Name 'FocusTracker' -Namespace 'Win32' -PassThru -ErrorAction SilentlyContinue
    if (-not $t) { $t = [Win32.FocusTracker] }
    
    # ShowWindow 9 = SW_RESTORE (restores from minimized)
    $t::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
    $t::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    
    Write-Output '{\\"success\\": true, \\"hwnd\\": \\"'$proc.MainWindowHandle'\\"}'
} else {
    Write-Output '{\\"success\\": false}'
}
"`;

  return new Promise((resolve) => {
    exec(psCommand, (error, stdout) => {
      try {
        const res = JSON.parse(stdout.trim());
        if (res.success) {
          desktopSession.setActiveWindow(res.hwnd, { title: appName });
          return resolve(true);
        }
      } catch (e) {}
      resolve(false);
    });
  });
}
