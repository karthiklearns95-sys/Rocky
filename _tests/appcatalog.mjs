/** App discovery tests (no dependencies, fake Start-menu list): node _tests/appcatalog.mjs */
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppCatalog, makeEntry, normalize, editDistance } from '../resolver/appCatalog.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}
const origLog = console.log, origWarn = console.warn;

// What Get-StartApps really returns: classic apps as {KnownFolder}\path\app.exe, Store apps as Package!App.
const START_APPS = [
  ['Notepad', '{F38BF404-1D43-42F2-9305-67DE0B28FC23}\\notepad.exe'],
  ['Notepad++', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Notepad++\\notepad++.exe'],
  ['Microsoft Word', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Microsoft Office\\root\\Office16\\WINWORD.EXE'],
  ['WordPad', '{F38BF404-1D43-42F2-9305-67DE0B28FC23}\\wordpad.exe'],
  ['Microsoft Excel', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Microsoft Office\\root\\Office16\\EXCEL.EXE'],
  ['PowerPoint', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Microsoft Office\\root\\Office16\\POWERPNT.EXE'],
  ['Outlook', 'Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookForWindows'],
  ['Visual Studio Code', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Microsoft VS Code\\Code.exe'],
  ['Code::Blocks', '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\\CodeBlocks\\codeblocks.exe'],
  ['Google Chrome', 'Chrome'],
  ['Microsoft Edge', 'MSEdge'],
  ['Spotify', 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'],
  ['Uninstall Spotify', 'C:\\Users\\g\\AppData\\Roaming\\Spotify\\uninstall.exe'],
  ['Calculator', 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'],
  ['Settings', 'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel'],
  ['Command Prompt', '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\cmd.exe'],
  ['Windows PowerShell', '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'],
  ['Windows Terminal', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe!App'],
  ['Microsoft Teams', 'MSTeams_8wekyb3d8bbwe!MSTeams'],
  ['Discord', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Discord Inc\\Discord.exe'],
  ['WhatsApp', '5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App'],
  ['Zoom Workplace', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Zoom\\bin\\Zoom.exe'],
  ['OBS Studio', '{6D809377-6AF0-444B-8957-A3773F02200E}\\obs-studio\\bin\\64bit\\obs64.exe'],
  ['Docker Desktop', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Docker\\Docker\\Docker Desktop.exe'],
  ['Adobe Photoshop 2024', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe'],
  ['VLC media player', '{6D809377-6AF0-444B-8957-A3773F02200E}\\VideoLAN\\VLC\\vlc.exe'],
  ['Photos', 'Microsoft.Windows.Photos_8wekyb3d8bbwe!App'],
  ['Mail', 'microsoft.windowscommunicationsapps_8wekyb3d8bbwe!microsoft.windowslive.mail'],
  ['Python 3.12 (64-bit)', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Python312\\python.exe'],
  ['Python 3.12 Manual (64-bit)', '{6D809377-6AF0-444B-8957-A3773F02200E}\\Python312\\Doc\\python312.chm'],
].map(([name, appId]) => ({ name, appId }));

const make = (extra = {}) => new AppCatalog({ loader: async () => START_APPS, storePath: null, ...extra });
const ready = async (c) => { c.init(); await c.refresh(); return c; };
const pick = async (q, c) => (await ready(c || make())).lookup(q);
const nameOf = async (q, c) => (await pick(q, c)).best?.name;

console.log('\nWhat Rocky understands');
await test('normalize keeps ++ meaningful so Notepad and Notepad++ differ', () => {
  assert.notEqual(normalize('Notepad++'), normalize('Notepad'));
  assert.equal(normalize('notepad plus plus'), normalize('Notepad++'));
  assert.equal(editDistance('calculater', 'calculator'), 1);
});
await test('Start-menu junk (uninstallers, manuals) is not an app', () => {
  assert.equal(makeEntry({ name: 'Uninstall Spotify', appId: 'x.exe' }), null);
  assert.equal(makeEntry({ name: 'Python 3.12 Manual (64-bit)', appId: 'x.chm' }), null);
  assert.equal(makeEntry({ name: '', appId: 'x' }), null);
});
await test('exact names, and Notepad is not confused with Notepad++', async () => {
  assert.equal(await nameOf('notepad'), 'Notepad');
  assert.equal(await nameOf('notepad++'), 'Notepad++');
  assert.equal(await nameOf('notepad plus plus'), 'Notepad++');
});
await test('names people actually say: no vendor, no version, acronyms, exe names', async () => {
  const c = await ready(make());
  for (const [q, expected] of [
    ['word', 'Microsoft Word'], ['excel', 'Microsoft Excel'], ['teams', 'Microsoft Teams'], ['chrome', 'Google Chrome'], ['edge', 'Microsoft Edge'],
    ['vscode', 'Visual Studio Code'], ['vs code', 'Visual Studio Code'], ['code', 'Visual Studio Code'], ['vsc', 'Visual Studio Code'],
    ['powershell', 'Windows PowerShell'], ['terminal', 'Windows Terminal'], ['cmd', 'Command Prompt'],
    ['photoshop', 'Adobe Photoshop 2024'], ['python', 'Python 3.12 (64-bit)'], ['docker', 'Docker Desktop'], ['vlc', 'VLC media player'],
    ['zoom', 'Zoom Workplace'], ['obs', 'OBS Studio'],
  ]) assert.equal(c.lookup(q).best?.name, expected, `"${q}"`);
});
await test('Word is not WordPad, and that is not flagged as ambiguous', async () => {
  const r = await pick('word');
  assert.equal(r.best.name, 'Microsoft Word');
  assert.equal(r.ambiguous, false);
});
await test('speech-recognition slips still find the app', async () => {
  assert.equal(await nameOf('calculater'), 'Calculator');
  assert.equal(await nameOf('spotifi'), 'Spotify');
  assert.equal(await nameOf('discorde'), 'Discord');
});
await test('short words never fuzzy-match (cmd must not become something else)', async () => {
  const r = await pick('cad');
  assert.equal(r.best, null);
});
await test('things that are not installed are not invented', async () => {
  const c = await ready(make());
  for (const q of ['banana', 'photoshopz2000', 'quantum flux editor', '']) assert.equal(c.lookup(q).best, null, q);
});
await test('"the spotify app" still finds Spotify', async () => {
  assert.equal(await nameOf('the spotify app'), 'Spotify');
});

console.log('\nAmbiguity and learning');
const TWO_PYTHONS = [...START_APPS, { name: 'Python 3.11 (64-bit)', appId: '{6D809377-6AF0-444B-8957-A3773F02200E}\\Python311\\python.exe' }];
await test('two equally good apps are reported as ambiguous, not guessed', async () => {
  const r = await pick('python', make({ loader: async () => TWO_PYTHONS }));
  assert.equal(r.ambiguous, true);
  assert.equal(r.matches.length, 2);
});
await test('launching an app a few times makes it the preferred one', async () => {
  const c = await ready(make({ loader: async () => TWO_PYTHONS }));
  const id311 = TWO_PYTHONS.at(-1).appId;
  for (let i = 0; i < 4; i++) c.recordLaunch(id311);
  const r = c.lookup('python');
  assert.equal(r.best.name, 'Python 3.11 (64-bit)');
  assert.equal(r.ambiguous, false);
});
await test('Grace\'s own word for an app works', async () => {
  const c = await ready(make());
  c.addAlias('my editor', START_APPS.find((a) => a.name === 'Visual Studio Code').appId);
  assert.equal(c.lookup('my editor').best.name, 'Visual Studio Code');
});
await test('usage never beats a clearly better text match', async () => {
  const c = await ready(make());
  for (let i = 0; i < 10; i++) c.recordLaunch(START_APPS.find((a) => a.name === 'Code::Blocks').appId);
  assert.equal(c.lookup('code').best.name, 'Visual Studio Code');
});

console.log('\nFinding apps in a sentence');
await test('finds the app named in a sentence; ignores everyday words', async () => {
  const c = await ready(make());
  assert.equal(c.findMentioned('please play something on spotify')?.name, 'Spotify');
  assert.equal(c.findMentioned('open notepad plus plus and type hello')?.name, 'Notepad++');
  assert.equal(c.findMentioned('take a photo of the mail'), null);
  assert.equal(c.findMentioned('what is the weather'), null);
});

console.log('\nCache and scanning');
await test('scan is saved to disk and a new session starts instantly from it', async () => {
  const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apps-')), 'cat.json');
  const a = new AppCatalog({ loader: async () => START_APPS, storePath: store });
  a.init(); await a.refresh();
  a.recordLaunch(START_APPS[0].appId);
  let loads = 0;
  const b = new AppCatalog({ loader: async () => { loads++; return START_APPS; }, storePath: store });
  b.init();                                              // synchronous: from disk
  assert.ok(b.size > 20);
  assert.equal(b.lookup('notepad').best.name, 'Notepad');
  assert.equal(b.usage[START_APPS[0].appId].uses, 1, 'usage survived the restart');
  assert.equal(loads, 0, 'fresh cache is not rescanned');
});
await test('a stale cache is refreshed in the background but still usable immediately', async () => {
  const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apps-')), 'cat.json');
  let t = 1_000_000;
  const a = new AppCatalog({ loader: async () => START_APPS, storePath: store, now: () => t });
  a.init(); await a.refresh();
  t += 3 * 24 * 3600 * 1000;
  let loads = 0;
  const b = new AppCatalog({ loader: async () => { loads++; return START_APPS; }, storePath: store, now: () => t });
  b.init();
  assert.equal(b.lookup('notepad').best.name, 'Notepad');
  await b.refreshing;
  assert.equal(loads, 1);
});
await test('simultaneous scans share one loader call', async () => {
  let loads = 0;
  const c = new AppCatalog({ loader: async () => { loads++; await new Promise((r) => setTimeout(r, 20)); return START_APPS; }, storePath: null });
  await Promise.all([c.refresh(), c.refresh(), c.refresh()]);
  assert.equal(loads, 1);
});
await test('a failed scan keeps the old list and does not throw', async () => {
  console.warn = () => {};
  let fail = false;
  const c = new AppCatalog({ loader: async () => { if (fail) throw new Error('boom'); return START_APPS; }, storePath: null });
  await c.refresh();
  fail = true;
  assert.equal(await c.refresh(), 0);
  assert.equal(c.lookup('notepad').best.name, 'Notepad');
  console.warn = origWarn;
});
await test('first run: find() waits for the first scan', async () => {
  const c = new AppCatalog({ loader: async () => { await new Promise((r) => setTimeout(r, 30)); return START_APPS; }, storePath: null });
  const r = await c.find('spotify');
  assert.equal(r.best.name, 'Spotify');
});
await test('a miss triggers one rescan (app just installed), not one per miss', async () => {
  let loads = 0, t = 1_000_000, installed = false;
  const c = new AppCatalog({ loader: async () => { loads++; return installed ? [...START_APPS, { name: 'Brand New App', appId: 'X!App' }] : START_APPS; }, storePath: null, now: () => t, rescanCooldownMs: 600000 });
  await c.refresh();
  installed = true;
  assert.equal((await c.find('brand new app')).best, null, 'inside the cooldown: no rescan');
  assert.equal(loads, 1);
  t += 700000;
  assert.equal((await c.find('brand new app')).best.name, 'Brand New App');
  assert.equal(loads, 2);
  await c.find('definitely not installed'); await c.find('also not installed');
  assert.equal(loads, 2, 'one rescan per cooldown');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
