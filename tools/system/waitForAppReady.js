import { execWithTimeout } from '../../automation/system/execWithTimeout.js';
import getActiveWindow from '../../automation/system/getActiveWindow.js';

/**
 * waitForAppReady
 *
 * Polls until a target app has an active, painted window — or the deadline expires.
 *
 * Changes from the original:
 *   - Replaced bare `exec` + `util.promisify` (no timeout) with `execWithTimeout`
 *     (6 second per-poll deadline so a frozen WMI call never hangs the agent).
 *   - Kept 500ms polling interval and 1000ms stabilisation wait unchanged.
 */
export default async function waitForAppReady({ appName, maxWaitMs = 5000 }) {
  if (!appName) {
    const active = await getActiveWindow();
    if (active?.success && active.appName !== 'unknown') {
      return { success: true, message: `${active.windowTitle || active.appName} is already active.` };
    }
    return { success: false, error: 'waitForAppReady requires appName when no active app is detectable.' };
  }

  console.log(`[WaitForAppReady] Waiting up to ${maxWaitMs}ms for "${appName}" to stabilize...`);

  const startTime     = Date.now();
  let   found         = false;
  const escapedName   = String(appName).replace(/'/g, "''");

  // Poll every 500ms until maxWaitMs is exhausted
  while (Date.now() - startTime < maxWaitMs) {
    // 6-second per-poll timeout — prevents WMI/COM hangs from stalling the whole poll loop
    const { stdout, timedOut } = await execWithTimeout(
      `powershell -NoProfile -Command ` +
      `"Get-Process | Where-Object { ($_.Name -match '${escapedName}' -or ` +
      `$_.MainWindowTitle -match '${escapedName}') -and $_.MainWindowTitle } | ` +
      `Select-Object -First 1 -Property Name,MainWindowTitle | ConvertTo-Json"`,
      { timeoutMs: 6000 }
    );

    if (!timedOut && stdout && stdout.trim()) {
      found = true;
      break;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  if (found) {
    // Extra 1000ms for UI painting and animation to finish
    await new Promise(r => setTimeout(r, 1000));
    return { success: true, message: `${appName} is ready and stabilized.` };
  }

  return { success: false, error: `App "${appName}" did not appear within ${maxWaitMs}ms.` };
}
