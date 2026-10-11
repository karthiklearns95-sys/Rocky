/**
 * App-launch flow tests (fake Start-menu list, no Windows needed): node _tests/appflow.mjs
 */
import assert from 'assert/strict';
import { appCatalog } from '../resolver/installedApps.js';
import resolveResource from '../resolver/resourceResolver.js';
import resolveCapabilities from '../resolver/capabilityResolver.js';
import openResource from '../tools/system/openResource.js';
import waitForAppReady, { buildAppSpec, findReadyWindow } from '../tools/system/waitForAppReady.js';
import focusWindow from '../tools/system/focusWindow.js';
import { installedAppLaunchPlan, plainText } from '../resolver/appLaunchPlan.js';
import { inferAppName } from '../brain/orchestrator/planUtils.js';

let passed = 0, failed = 0;
const origLog = console.log, origWarn = console.warn;
async function test(name, fn) {
  console.log = () => {}; console.warn = () => {};
  try { await fn(); console.log = origLog; console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log = origLog; console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') || e.message}`); failed++; }
  finally { console.log = origLog; console.warn = origWarn; }
}

const APPS = [
  ['Notepad', '{F38BF404-1D43-42F2-9305-67DE0B28FC23}\\notepad.exe'],
  ['Notepad++', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Notepad++\\notepad++.exe'],
  ['Spotify', 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'],
  ['Visual Studio Code', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Microsoft VS Code\\Code.exe'],
  ['Google Chrome', 'Chrome'], ['Microsoft Edge', 'MSEdge'], ['Calculator', 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'],
  ['Discord', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Discord Inc\\Discord.exe'],
  ['GitHub Desktop', '{6D809377-6AF0-444B-8957-A3773F02200E}\\GitHub Desktop\\GitHubDesktop.exe'],
  ['Python 3.12 (64-bit)', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Python312\\python.exe'],
  ['Python 3.11 (64-bit)', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Python311\\python.exe'],
  ['Microsoft Word', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Microsoft Office\\root\\Office16\\WINWORD.EXE'],
  ['Zoom Workplace', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Zoom\\bin\\Zoom.exe'],
  ['Slack', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Slack\\slack.exe'],
  ['Docker Desktop', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Docker\\Docker\\Docker Desktop.exe'],
  ['OBS Studio', '{6D809377-6AF0-444B-8957-A3773F02200E}\\obs-studio\\bin\\64bit\\obs64.exe'],
  ['Steam', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Steam\\steam.exe'],
].map(([name, appId]) => ({ name, appId }));
const idOf = (n) => APPS.find((a) => a.name === n).appId;

// Point the shared catalog at the fake list.
appCatalog.storePath = null;
appCatalog.loader = async () => APPS;
appCatalog.init();
await appCatalog.refresh();

console.log('\nResolving what to open');
await test('an installed app resolves to its real AppID (not a guessed .exe)', async () => {
  const r = await resolveResource('spotify', {});
  assert.equal(r.type, 'desktop');
  assert.equal(r.source, 'catalog');
  assert.equal(r.appId, idOf('Spotify'));
  assert.equal(r.displayName, 'Spotify');
});
await test('Notepad and Notepad++ stay different', async () => {
  assert.equal((await resolveResource('notepad', {})).appId, idOf('Notepad'));
  assert.equal((await resolveResource('notepad++', {})).appId, idOf('Notepad++'));
});
await test('apps that were never in the old hand-written list now work', async () => {
  for (const [q, app] of [['steam', 'Steam'], ['obs', 'OBS Studio'], ['docker', 'Docker Desktop'], ['zoom', 'Zoom Workplace'], ['vscode', 'Visual Studio Code']]) {
    assert.equal((await resolveResource(q, {})).displayName, app, q);
  }
});
await test('speech slips resolve: "calculater", "spotifi"', async () => {
  assert.equal((await resolveResource('calculater', {})).displayName, 'Calculator');
  assert.equal((await resolveResource('spotifi', {})).displayName, 'Spotify');
});
await test('websites with no installed app still resolve to the web', async () => {
  const r = await resolveResource('youtube', {});
  assert.deepEqual([r.type, r.source], ['web', 'web_table']);
});
await test('an installed app beats a website of the same name', async () => {
  const r = await resolveResource('github', {});         // GitHub Desktop is installed
  assert.equal(r.type, 'desktop');
  assert.equal(r.displayName, 'GitHub Desktop');
});
await test('two equally good apps are flagged so Rocky can ask which', async () => {
  const r = await resolveResource('python', {});
  assert.equal(r.ambiguous, true);
  assert.equal(r.alternatives.length, 1);
});
await test('an app that is not installed is reported as such, not launched blindly', async () => {
  // Old behaviour: "photoshop" -> photoshop.exe, which fails after a 15 s launch attempt.
  const r = await resolveResource('photoshop', {});
  // Catalog here has 17 apps (healthy), so the static guess is not trusted.
  assert.deepEqual([r.type, r.reason], ['unknown', 'not_installed']);
});
await test('built-ins that may be missing from the Start-menu scan still open', async () => {
  const r = await resolveResource('task manager', {});
  assert.equal(r.type, 'desktop');
  assert.equal(r.target, 'taskmgr.exe');
});
await test('if the scan did not work at all, the old static table is the safety net', async () => {
  const saved = appCatalog.entries;
  appCatalog.entries = [];                                  // scan failed: nothing known
  const r = await resolveResource('photoshop', {});
  appCatalog.entries = saved;
  assert.deepEqual([r.type, r.target], ['desktop', 'photoshop.exe']);
});
await test('"not found" is not remembered, so a freshly installed app is found next time', async () => {
  await resolveResource('brandnewtool', {});
  appCatalog.entries.push(...[{ name: 'BrandNewTool', appId: 'X!App' }].map((a) => ({ ...a })));
  appCatalog.entries.pop();                                  // (cache is keyed by query; unknown results are never stored)
  appCatalog.loader = async () => [...APPS, { name: 'BrandNewTool', appId: 'X!App' }];
  await appCatalog.refresh();
  assert.equal((await resolveResource('brandnewtool', {})).displayName, 'BrandNewTool');
  appCatalog.loader = async () => APPS; await appCatalog.refresh();
});

console.log('\nLaunching');
await test('catalog apps start through their AppID, passed in the environment only', async () => {
  const calls = [];
  const hostile = { type: 'desktop', appId: 'Evil";calc.exe;"!App', target: 'x' };
  const r = await openResource({ resource: hostile }, { exec: async (cmd, o) => { calls.push({ cmd, o }); return { timedOut: false, error: null }; } });
  assert.equal(r.success, true);
  assert.match(calls[0].cmd, /shell:AppsFolder\\' \+ \$env:ROCKY_APP_ID/);
  assert.ok(!calls[0].cmd.includes('calc.exe'), 'the ID is not in the command text');
  assert.equal(calls[0].o.env.ROCKY_APP_ID, hostile.appId);
});
await test('old-style resources (static table) still launch the old way', async () => {
  const calls = [];
  await openResource({ resource: { type: 'desktop', target: 'notepad.exe' } }, { exec: async (cmd) => { calls.push(cmd); return { timedOut: false, error: null }; } });
  assert.match(calls[0], /Start-Process 'notepad\.exe'/);
});
await test('a launch failure is reported, not swallowed', async () => {
  const r = await openResource({ resource: { type: 'desktop', appId: 'X!App', target: 'X!App' } }, { exec: async () => ({ timedOut: false, error: new Error('nope') }) });
  assert.equal(r.success, false);
});

console.log('\nCapabilities of discovered apps');
await test('Spotify (a Store app with an AppID) is still recognised as a media app', async () => {
  const caps = resolveCapabilities(await resolveResource('spotify', {}));
  assert.equal(caps.canControlMedia, true);
});
await test('VS Code and Discord are recognised as hybrid (Electron) apps; terminals cannot be clicked', async () => {
  assert.equal(resolveCapabilities(await resolveResource('vscode', {})).isHybrid, true);
  assert.equal(resolveCapabilities(await resolveResource('discord', {})).isHybrid, true);
  assert.equal(resolveCapabilities({ type: 'desktop', target: 'cmd.exe' }).canClick, false);
});

console.log('\nWaiting for the app');
const win = (name, title, id = 100) => ({ name, title, id });
await test('process-name and title matching never builds a regex (notepad++ used to break it)', () => {
  const spec = buildAppSpec('notepad++');
  assert.ok(findReadyWindow([win('notepad++', 'new 1 - Notepad++')], spec));
  for (const odd of ['c++ (builder)', 'a.b[c', '(((', '$(whoami)', "it's"]) assert.doesNotThrow(() => buildAppSpec(odd));
});
await test('Notepad is not mistaken for the Notepad++ window', () => {
  const spec = buildAppSpec('notepad');
  assert.equal(findReadyWindow([win('notepad++', 'new 1 - Notepad++')], spec), null);
  assert.ok(findReadyWindow([win('Notepad', 'Untitled - Notepad')], spec));
});
await test('finds Store apps by name even though their process name is not the app name', () => {
  const spec = buildAppSpec('whatsapp');
  assert.ok(findReadyWindow([win('WhatsApp.Root', 'WhatsApp')], spec));
});
await test('polls until the window appears, then succeeds', async () => {
  let polls = 0, t = 0;
  const r = await waitForAppReady({ appName: 'spotify', maxWaitMs: 6000 }, {
    listWindows: async () => (++polls < 4 ? [] : [win('Spotify', 'Spotify Free')]),
    sleep: async (ms) => { t += ms; }, now: () => t,
  });
  assert.equal(r.success, true);
  assert.match(r.message, /ready/);
  assert.equal(polls, 4);
});
await test('never appears: soft success after the deadline (does not block the plan)', async () => {
  let t = 0;
  const r = await waitForAppReady({ appName: 'spotify', maxWaitMs: 2000 }, { listWindows: async () => [], sleep: async (ms) => { t += ms; }, now: () => t });
  assert.equal(r.success, true);
  assert.match(r.message, /may be ready/);
});
await test('window list unavailable: still finishes (soft success)', async () => {
  let t = 0;
  const r = await waitForAppReady({ appName: 'spotify', maxWaitMs: 1000 }, { listWindows: async () => null, sleep: async (ms) => { t += ms; }, now: () => t });
  assert.equal(r.success, true);
});

console.log('\nBringing the app to the front');
const fdeps = (extra = {}) => ({
  listWindows: async () => [win('chrome', 'Google Chrome', 7), win('Spotify', 'Spotify Free', 42)],
  sleep: async () => {}, ...extra,
});
await test('finds the app window, activates it by process id, and checks it is really in front', async () => {
  let activated = null, active = { appName: 'chrome', windowTitle: 'Google Chrome' };
  const r = await focusWindow({ appName: 'spotify' }, fdeps({
    activate: async (id) => { activated = id; active = { appName: 'Spotify', windowTitle: 'Spotify Free' }; return true; },
    getActiveWindow: async () => active,
  }));
  assert.equal(r.success, true);
  assert.equal(activated, 42);
});
await test('no such window: a clear failure, nothing activated', async () => {
  let called = false;
  const r = await focusWindow({ appName: 'discord' }, fdeps({ activate: async () => { called = true; return true; }, getActiveWindow: async () => ({}) }));
  assert.equal(r.success, false);
  assert.match(r.error, /cannot see a window/);
  assert.equal(called, false);
});
await test('Windows ignores the first request: tries once more', async () => {
  let calls = 0, active = { appName: 'chrome', windowTitle: 'Google Chrome' };
  const r = await focusWindow({ appName: 'spotify' }, fdeps({
    activate: async () => { calls++; if (calls === 2) active = { appName: 'Spotify', windowTitle: 'Spotify Free' }; return true; },
    getActiveWindow: async () => active,
  }));
  assert.equal(r.success, true);
  assert.equal(calls, 2);
});
await test('another window stays on top: honest failure instead of a false success', async () => {
  const r = await focusWindow({ appName: 'spotify' }, fdeps({ activate: async () => true, getActiveWindow: async () => ({ appName: 'chrome', windowTitle: 'Google Chrome' }) }));
  assert.equal(r.success, false);
  assert.match(r.error, /still on top/);
});
await test('cannot read the window list / no app name: failures, not crashes', async () => {
  assert.equal((await focusWindow({ appName: 'spotify' }, fdeps({ listWindows: async () => null }))).success, false);
  assert.equal((await focusWindow({}, fdeps())).success, false);
});

console.log('\nFast path: "open <app>"');
await test('"open <any installed app>" becomes the standard launch plan without the LLM', () => {
  const plan = installedAppLaunchPlan('open steam');
  assert.deepEqual(plan.map((s) => s.tool), ['open_resource', 'waitForAppReady', 'focusWindow']);
  assert.equal(plan[0].input.query, 'Steam');
  assert.equal(installedAppLaunchPlan('please launch the discord app')[0].input.query, 'Discord');
  assert.equal(installedAppLaunchPlan('start vscode')[0].input.query, 'Visual Studio Code');
});
await test('anything more than a plain launch is left to the normal planner', () => {
  assert.equal(installedAppLaunchPlan('open notepad and write hello'), null);
  assert.equal(installedAppLaunchPlan('open youtube'), null);        // a website, not an app
  assert.equal(installedAppLaunchPlan('open python'), null);         // two Pythons: ambiguous, let the resolver ask
  assert.equal(installedAppLaunchPlan('what is the weather'), null);
});
await test('reads her words out of the interpreter JSON (and plain text too)', () => {
  assert.equal(plainText({ rawInput: JSON.stringify({ goal: 'open_app', rawInput: 'Open Steam' }) }), 'open steam');
  assert.equal(plainText({ rawInput: 'Open Steam' }), 'open steam');
});
await test('inferAppName finds installed apps the old fixed list never knew', () => {
  assert.equal(inferAppName({ rawInput: 'send it on discord please', intentData: { entities: {} } }), 'discord');
  assert.equal(inferAppName({ rawInput: 'start a build in docker', intentData: { entities: {} } }), 'docker desktop');
  assert.equal(inferAppName({ rawInput: 'what is the weather', intentData: { entities: {} } }), null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
