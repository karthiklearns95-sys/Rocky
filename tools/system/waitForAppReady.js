import { execWithTimeout } from '../../automation/system/execWithTimeout.js';
import getActiveWindow from '../../automation/system/getActiveWindow.js';

/**
 * waitForAppReady
 *
 * Polls until a target app has an active, painted window — or the deadline expires.
 */

// Maps friendly app names (from planner) to real Windows process names
const APP_NAME_ALIASES = {
  'file explorer':  'explorer',
  'explorer':       'explorer',
  'vs code':        'code',
  'vscode':         'code',
  'visual studio code': 'code',
  'chrome':         'chrome',
  'google chrome':  'chrome',
  'edge':           'msedge',
  'microsoft edge': 'msedge',
  'notepad':        'notepad',
  'notepad++':      'notepad++',
  'calculator':     'calculatorapp',
  'spotify':        'spotify',
  'slack':          'slack',
  'discord':        'discord',
  'teams':          'teams',
  'whatsapp':       'whatsapp',
  'terminal':       'windowsterminal',
  'cmd':            'cmd',
  'powershell':     'powershell',
  'task manager':   'taskmgr',
};

export default async function waitForAppReady({ appName, maxWaitMs = 6000 }) {
  if (!appName) {
    const active = await getActiveWindow();
    if (active?.success && active.appName !== 'unknown') {
      return { success: true, message: `${active.windowTitle || active.appName} is already active.` };
    }
    return { success: false, error: 'waitForAppReady requires appName when no active app is detectable.' };
  }

  // Resolve alias → real process name
  const normalizedName = String(appName).toLowerCase().trim();
  const resolvedName = APP_NAME_ALIASES[normalizedName] || normalizedName;

  console.log(`[WaitForAppReady] Waiting up to ${maxWaitMs}ms for "${appName}" (process: "${resolvedName}") to stabilize...`);

  const startTime   = Date.now();
  let   found       = false;
  const escaped     = resolvedName.replace(/'/g, "''");
  const escapedOrig = normalizedName.replace(/'/g, "''");

  // Poll every 500ms until maxWaitMs is exhausted
  while (Date.now() - startTime < maxWaitMs) {
    const { stdout, timedOut } = await execWithTimeout(
      `powershell -NoProfile -Command ` +
      `"Get-Process | Where-Object { ($_.Name -match '${escaped}' -or ` +
      `$_.Name -match '${escapedOrig}' -or ` +
      `$_.MainWindowTitle -match '${escapedOrig}') -and $_.MainWindowTitle } | ` +
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
    await new Promise(r => setTimeout(r, 800)); // Let UI paint
    return { success: true, message: `${appName} is ready and stabilized.` };
  }

  // Soft fail — don't block the plan, let execution continue
  console.warn(`[WaitForAppReady] "${appName}" not detected within ${maxWaitMs}ms — continuing anyway.`);
  return { success: true, message: `${appName} may be ready (timeout reached, continuing).` };
}
