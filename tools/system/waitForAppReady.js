import getActiveWindow from '../../automation/system/getActiveWindow.js';
import { appCatalog, listWindowedProcesses } from '../../resolver/installedApps.js';
import { normalize } from '../../resolver/appCatalog.js';

/**
 * waitForAppReady
 *
 * Polls until a target app has an active, painted window — or the deadline expires.
 */

// Maps friendly app names (from planner) to real Windows process names. This is only a head
// start: apps found in the installed-apps catalog bring their own process name and title.
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

/**
 * What to look for: process names and window-title words for an app. Plain data, so the
 * matching below never builds a regular expression or PowerShell text from the app name
 * (the old version broke on names like "notepad++").
 */
export function buildAppSpec(appName, catalog = appCatalog) {
  const asked = normalize(appName);
  const alias = APP_NAME_ALIASES[String(appName).toLowerCase().trim()];
  const procs = new Set();
  const titles = new Set();
  const addProc = (p) => { const n = String(p || '').toLowerCase().replace(/\.exe$/, '').replace(/\s+/g, ''); if (n.length >= 3) procs.add(n); };
  const addTitle = (t) => { const n = normalize(t); if (n.length >= 3) titles.add(n); };

  addProc(alias);
  addProc(asked);
  addTitle(asked);

  // Longer app names that contain this one ("Notepad++" for "Notepad"): a window titled like that
  // belongs to the other app, so it must not satisfy a wait for the shorter name.
  const notTitles = new Set();

  const found = catalog.lookup(appName, { minScore: 0.85 });
  if (found.best && !found.ambiguous) {
    addProc(found.best.exe);
    addTitle(found.best.name);
    for (const a of found.best.aliases) if (a.length >= 4) addTitle(a);
    for (const other of catalog.entries || []) {
      if (other.appId !== found.best.appId && other.norm.startsWith(`${found.best.norm} `)) notTitles.add(other.norm);
    }
  }
  return { procs: [...procs], titles: [...titles], notTitles: [...notTitles] };
}

/** First window that belongs to the app described by `spec`, or null. */
export function findReadyWindow(windows, spec) {
  for (const w of windows || []) {
    const proc = String(w.name || '').toLowerCase().replace(/\.exe$/, '');
    // Same process, or the same app with a suffix like "whatsapp.root" / "chrome_1". Not "notepad++" for "notepad".
    if (spec.procs.some((p) => proc === p || (p.length >= 4 && proc.startsWith(p) && /^[._\-\d]/.test(proc.slice(p.length))))) return w;
  }
  for (const w of windows || []) {
    const title = ` ${normalize(w.title)} `;
    if ((spec.notTitles || []).some((t) => title.includes(` ${t} `))) continue;
    if (spec.titles.some((t) => title.includes(` ${t} `))) return w;
  }
  return null;
}

export default async function waitForAppReady({ appName, maxWaitMs = 6000 }, deps = {}) {
  const listWindows = deps.listWindows || listWindowedProcesses;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now || Date.now;

  if (!appName) {
    const active = await getActiveWindow();
    if (active?.success && active.appName !== 'unknown') {
      return { success: true, message: `${active.windowTitle || active.appName} is already active.` };
    }
    return { success: false, error: 'waitForAppReady requires appName when no active app is detectable.' };
  }

  const spec = buildAppSpec(appName, deps.catalog || appCatalog);
  console.log(`[WaitForAppReady] Waiting up to ${maxWaitMs}ms for "${appName}" (processes: ${spec.procs.join(', ') || '-'}) to appear...`);

  const startTime = now();
  let found = false;
  let sawList = false;

  // The persistent worker answers in milliseconds, so poll quickly.
  while (now() - startTime < maxWaitMs) {
    const windows = await listWindows();
    if (Array.isArray(windows)) {
      sawList = true;
      if (findReadyWindow(windows, spec)) { found = true; break; }
    }
    await sleep(300);
  }

  if (found) {
    await sleep(800); // Let UI paint
    return { success: true, message: `${appName} is ready and stabilized.` };
  }

  // Soft fail — don't block the plan, let execution continue
  console.warn(`[WaitForAppReady] "${appName}" not detected within ${maxWaitMs}ms${sawList ? '' : ' (window list unavailable)'} — continuing anyway.`);
  return { success: true, message: `${appName} may be ready (timeout reached, continuing).` };
}
