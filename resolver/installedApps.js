import { AppCatalog } from './appCatalog.js';
import { tryWorker } from '../automation/system/psWorker.js';
import { execWithTimeout } from '../automation/system/execWithTimeout.js';

/**
 * Windows side of app discovery: reads the Start menu app list and the list of
 * running windows. Both use the persistent worker when it is up and fall back to
 * a one-shot PowerShell otherwise. Neither command contains any user text.
 */

async function loadStartApps() {
  const fast = await tryWorker('apps', {}, { timeoutMs: 25000 });
  if (fast.ok && Array.isArray(fast.result)) return fast.result;

  const { stdout, timedOut, error } = await execWithTimeout(
    `powershell -NoProfile -NonInteractive -Command "Get-StartApps | Select-Object @{n='name';e={$_.Name}}, @{n='appId';e={$_.AppID}} | ConvertTo-Json -Compress"`,
    { timeoutMs: 25000 }
  );
  if (timedOut || error || !stdout.trim()) throw new Error(timedOut ? 'app list timed out' : (error?.message || 'empty app list'));
  const data = JSON.parse(stdout);
  return Array.isArray(data) ? data : [data];
}

/** The shared catalog of installed apps. Loaded lazily; call appCatalog.init() early to warm it. */
export const appCatalog = new AppCatalog({ loader: loadStartApps });

/** Windows that currently have a title: [{ name, title, id }]. Returns null if it cannot be read. */
export async function listWindowedProcesses() {
  const fast = await tryWorker('processes', {}, { timeoutMs: 6000 });
  if (fast.ok && Array.isArray(fast.result)) return fast.result;

  const { stdout, timedOut, error } = await execWithTimeout(
    `powershell -NoProfile -NonInteractive -Command "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object @{n='name';e={$_.Name}}, @{n='title';e={$_.MainWindowTitle}}, @{n='id';e={$_.Id}} | ConvertTo-Json -Compress"`,
    { timeoutMs: 8000 }
  );
  if (timedOut || error) return null;
  if (!stdout.trim()) return [];
  try {
    const data = JSON.parse(stdout);
    return Array.isArray(data) ? data : [data];
  } catch {
    return null;
  }
}
