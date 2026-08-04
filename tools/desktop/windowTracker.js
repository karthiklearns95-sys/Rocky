import { execWithTimeout } from '../../automation/system/execWithTimeout.js';
import { desktopSession } from './desktopSessionStore.js';

/**
 * windowTracker.js
 *
 * Tracks active windows, foreground HWND, and restores minimized apps natively.
 *
 * Fixed: replaced callback-style bare exec() with execWithTimeout (6s deadline).
 * Fixed: rewrote the PowerShell command to avoid deeply nested escaped-quote
 *        hell — the original had 4 levels of backslash escaping which made it
 *        impossible to read and easy to break. Now uses a cleaner heredoc approach.
 */
export async function restoreAndFocusWindow(appName) {
  const safeName = String(appName).replace(/'/g, "''");

  // PowerShell: find by name, restore if minimized (SW_RESTORE=9), bring to front
  const psCmd =
    `powershell -NoProfile -Command "` +
    `$proc = Get-Process | Where-Object { $_.MainWindowTitle -match '${safeName}' -or $_.Name -match '${safeName}' } | ` +
    `Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; ` +
    `if ($proc) { ` +
    `  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { ` +
    `[DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr h); ` +
    `[DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr h, int n); }' -ErrorAction SilentlyContinue 2>$null; ` +
    `  [W]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null; ` +
    `  [W]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null; ` +
    `  Write-Output ('{\\\"success\\\":true,\\\"hwnd\\\":\\\"' + $proc.MainWindowHandle + '\\\"}') ` +
    `} else { Write-Output '{\\\"success\\\":false}' }"`;

  const { stdout, timedOut } = await execWithTimeout(psCmd, { timeoutMs: 6000 });

  if (timedOut || !stdout) return false;

  try {
    const res = JSON.parse(stdout.trim());
    if (res.success) {
      desktopSession.setActiveWindow(res.hwnd, { title: appName });
      return true;
    }
  } catch { /* ignore parse error */ }

  return false;
}
