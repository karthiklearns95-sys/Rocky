import { exec } from 'child_process';
import util from 'util';
import getActiveWindow from '../../executor/system/getActiveWindow.js';

const execAsync = util.promisify(exec);

export default async function waitForAppReady({ appName, maxWaitMs = 5000 }) {
  if (!appName) {
    const active = await getActiveWindow();
    if (active?.success && active.appName !== 'unknown') {
      return { success: true, message: `${active.windowTitle || active.appName} is already active.` };
    }
    return { success: false, error: 'waitForAppReady requires appName when no active app is detectable.' };
  }

  console.log(`[WaitForAppReady] Waiting up to ${maxWaitMs}ms for ${appName} to stabilize...`);
  
  const startTime = Date.now();
  let found = false;
  const escapedAppName = String(appName).replace(/'/g, "''");

  // Poll every 500ms
  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Check for process AND window title to ensure it's not just a background process
      const psCmd = `powershell -NoProfile -Command "Get-Process | Where-Object { ($_.Name -match '${escapedAppName}' -or $_.MainWindowTitle -match '${escapedAppName}') -and $_.MainWindowTitle } | Select-Object -First 1 -Property Name,MainWindowTitle | ConvertTo-Json"`;
      const { stdout } = await execAsync(psCmd);
      if (stdout && stdout.trim()) {
        found = true;
        break;
      }
    } catch {
      // ignore transient process lookup failures
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (found) {
    // Wait an extra 1000ms for UI painting and animations to finish
    await new Promise(r => setTimeout(r, 1000));
    return { success: true, message: `${appName} is ready and stabilized.` };
  } else {
    return { success: false, error: `App ${appName} did not appear within ${maxWaitMs}ms.` };
  }
}
