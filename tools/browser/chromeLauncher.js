import fs from 'fs';
import path from 'path';
import { spawn as nodeSpawn } from 'child_process';

/**
 * Start (or find) Rocky's own Chrome/Edge with the DevTools protocol (CDP) switched on.
 *
 * Why not Playwright's own launch: a browser Playwright starts dies with Rocky and cannot be
 * shared. A browser started here is an ordinary detached window with a debugging port on
 * 127.0.0.1: it survives Rocky restarts, Rocky re-attaches to it (and to the tabs already open),
 * and you can look inside with chrome://inspect. It uses its own profile folder because Chrome 136+
 * ignores the debugging port for the everyday profile.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where Chrome or Edge might be, best first. `override` (ROCKY_BROWSER_PATH) always wins. */
export function browserCandidates({ env = process.env, platform = process.platform, override = null } = {}) {
  if (override) return [override];
  if (platform !== 'win32') {
    return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }
  const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
  const fallbackRoots = roots.length ? roots : ['C:\\Program Files', 'C:\\Program Files (x86)'];
  const rel = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe'];
  return rel.flatMap((r) => fallbackRoots.map((root) => `${root}\\${r}`));
}

export function findBrowser({ exists = fs.existsSync, ...opts } = {}) {
  const found = browserCandidates(opts).find((p) => exists(p));
  if (!found) throw new Error('No Chrome or Edge found. Install one, or set ROCKY_BROWSER_PATH to its full path.');
  return found;
}

/** Command-line arguments for Rocky's browser. */
export function buildLaunchArgs({ port, userDataDir, extra = [] }) {
  return [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',     // never reachable from the network
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    ...extra,
  ];
}

/** Is a DevTools endpoint answering? -> { ok, browser?, wsUrl?, error? } */
export async function probeEndpoint(port, { fetchFn = fetch, timeoutMs = 1500 } = {}) {
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    return { ok: true, browser: body.Browser, wsUrl: body.webSocketDebuggerUrl };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Make sure Rocky's browser is running with a debugging port. Returns { endpoint, launched, browser }.
 * Everything that touches the OS is a parameter so this is testable.
 */
export async function ensureBrowser({
  port, userDataDir, executable = null, startTimeoutMs = 15000, extraArgs = [],
  probe = probeEndpoint, spawn = nodeSpawn, find = findBrowser, mkdir = (d) => fs.mkdirSync(d, { recursive: true }),
  sleepFn = sleep, now = Date.now, env = process.env, platform = process.platform,
} = {}) {
  const endpoint = `http://127.0.0.1:${port}`;

  const running = await probe(port);
  if (running.ok) return { endpoint, launched: false, browser: running.browser };

  mkdir(path.resolve(userDataDir));
  const exe = executable || find({ env, platform });
  const args = buildLaunchArgs({ port, userDataDir: path.resolve(userDataDir), extra: extraArgs });
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  // A spawn failure (bad path, no permission) arrives as an event, not a throw.
  let spawnError = null;
  child.once?.('error', (e) => { spawnError = e; });
  child.unref?.();

  const started = now();
  while (now() - started < startTimeoutMs) {
    if (spawnError) throw new Error(`Could not start the browser (${exe}): ${spawnError.message}`);
    await sleepFn(250);
    const up = await probe(port);
    if (up.ok) return { endpoint, launched: true, browser: up.browser };
  }
  // Most likely cause: Rocky's profile is already open in a browser that was started WITHOUT the port,
  // so the new process just handed over to it and exited.
  throw new Error(
    `Rocky's browser did not open its DevTools port (${port}) within ${Math.round(startTimeoutMs / 1000)}s. ` +
    `If a Chrome window using Rocky's profile (${path.resolve(userDataDir)}) is already open, close it and try again.`
  );
}
