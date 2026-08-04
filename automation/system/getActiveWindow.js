import { execWithTimeout } from './execWithTimeout.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Detects the current foreground window using a temp PS1 file.
 * Writing to a file avoids all shell-escaping issues.
 *
 * Fixed: replaced bare exec() (no timeout) with execWithTimeout (5s deadline).
 * getActiveWindow() is called on every AgentLoop step — a hung PS query previously
 * froze the entire execution loop indefinitely.
 */

const SCRIPT_PATH = path.join(os.tmpdir(), 'rocky_get_window.ps1');

const SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@
$hwnd = [Win32]::GetForegroundWindow()
$proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $hwnd } | Select-Object -First 1
$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$bounds = [PSCustomObject]@{
    x      = $rect.Left
    y      = $rect.Top
    width  = [Math]::Max(0, $rect.Right - $rect.Left)
    height = [Math]::Max(0, $rect.Bottom - $rect.Top)
}
if ($proc) {
    [PSCustomObject]@{
        appName     = $proc.ProcessName
        windowTitle = $proc.MainWindowTitle
        bounds      = $bounds
        isMinimized = [Win32]::IsIconic($hwnd)
        success     = $true
    } | ConvertTo-Json
} else {
    [PSCustomObject]@{
        appName     = "unknown"
        windowTitle = "unknown"
        bounds      = $bounds
        isMinimized = $false
        success     = $true
    } | ConvertTo-Json
}
`.trim();

const FALLBACK = { appName: 'unknown', windowTitle: 'unknown', isMinimized: false, success: true };

// Write the script once at module load — avoids repeated I/O on every call.
try { fs.writeFileSync(SCRIPT_PATH, SCRIPT, 'utf8'); } catch { /* non-fatal */ }

export default async function getActiveWindow() {
  const { stdout, timedOut, error } = await execWithTimeout(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${SCRIPT_PATH}"`,
    { timeoutMs: 5000 }
  );

  if (timedOut || error || !stdout) return FALLBACK;

  try {
    const result = JSON.parse(stdout.trim());
    console.log(`[getActiveWindow] ${result.appName} — "${result.windowTitle}"`);
    return result;
  } catch {
    return FALLBACK;
  }
}
