import getActiveWindow from '../../automation/system/getActiveWindow.js';
import { tryWorker } from '../../automation/system/psWorker.js';
import { execWithTimeout } from '../../automation/system/execWithTimeout.js';
import { appCatalog, listWindowedProcesses } from '../../resolver/installedApps.js';
import { buildAppSpec, findReadyWindow } from './waitForAppReady.js';
import { screenChanged } from './screenCache.js';

/**
 * focusWindow - bring an app's window to the front.
 *
 * This used to be a stub that always reported failure, so every "open <app>" plan
 * ended with a failing last step, burned its retries and gave up although the app
 * was already open. It now finds the app's window (the same matching waitForAppReady
 * uses: process name from the installed-apps catalog, then window title), restores
 * it if minimised, brings it forward, and checks that it really became the active
 * window.
 */

// One-shot fallback when the persistent worker is down. The process id travels in the
// environment; no text from the user or the LLM is placed into the command.
const ACTIVATE_CMD =
  `powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName Microsoft.VisualBasic; ` +
  `[Microsoft.VisualBasic.Interaction]::AppActivate([int]$env:ROCKY_PID)"`;

export default async function focusWindow(args = {}, deps = {}) {
  const { appName } = args;
  if (!appName) return { success: false, error: 'focusWindow requires appName.' };

  const listWindows = deps.listWindows || listWindowedProcesses;
  const activate = deps.activate || (async (id) => {
    const fast = await tryWorker('focus', { id }, { timeoutMs: 5000 });
    if (fast.ok) return true;
    const { timedOut, error } = await execWithTimeout(ACTIVATE_CMD, { timeoutMs: 5000, env: { ROCKY_PID: String(id) } });
    return !timedOut && !error;
  });
  const getActive = deps.getActiveWindow || getActiveWindow;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const spec = buildAppSpec(appName, deps.catalog || appCatalog);
  const windows = await listWindows();
  if (!Array.isArray(windows)) return { success: false, error: `Could not look at the open windows to find "${appName}".` };

  const target = findReadyWindow(windows, spec);
  if (!target) return { success: false, error: `Rocky cannot see a window for "${appName}". Is it open?` };

  console.log(`[Tool: focusWindow] Bringing "${target.title}" (${target.name}) to the front.`);
  const ok = await activate(target.id);
  screenChanged();
  if (!ok) return { success: false, error: `Rocky could not bring "${appName}" to the front.` };

  // Windows sometimes ignores the first request; check, and try once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    await sleep(attempt === 0 ? 150 : 300);
    const active = await getActive();
    const activeProc = String(active?.appName || '').toLowerCase();
    if (activeProc === String(target.name).toLowerCase() || (active?.windowTitle && active.windowTitle === target.title)) {
      return { success: true, data: `${target.title} is in front.`, window: { name: target.name, title: target.title } };
    }
    if (attempt === 0) await activate(target.id);
  }
  return { success: false, error: `Rocky asked for "${appName}" to come forward, but another window is still on top.` };
}
