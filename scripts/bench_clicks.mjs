// Click-speed benchmark (Windows). Run:  node scripts/bench_clicks.mjs ["text to look for"]
//
// Times each building block of a click the OLD way (a new PowerShell process per lookup)
// and the NEW way (the persistent worker), so you can see what the speed-up really is on
// this machine, and checks that the worker answers every command.
//
// Put a normal app window (Notepad, Settings, a browser) in front first, and pass a word
// that is visible in it as the argument (default: "File").

import { psWorker } from '../automation/system/psWorker.js';
import { screenChanged } from '../tools/system/screenCache.js';

if (process.platform !== 'win32') {
  console.log('This benchmark measures Windows UI Automation and OCR, so it only runs on Windows.');
  process.exit(0);
}

const target = process.argv[2] || 'File';
const RUNS = 5;
const log = console.log;
console.log = () => {};      // silence the tools' own chatter; the table is the output
console.warn = () => {};

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

async function time(fn) {
  screenChanged();                       // never measure a cached answer
  const t = process.hrtime.bigint();
  let out, err;
  try { out = await fn(); } catch (e) { err = e; }
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, out, err };
}

async function measure(name, fn, check = () => true) {
  const row = { name };
  for (const mode of ['old', 'new']) {
    psWorker.enabled = mode === 'new';
    psWorker.dispose();                  // 'new' pays its start-up once, in the first run
    const first = await time(fn);
    const warm = [];
    for (let i = 0; i < RUNS; i++) warm.push((await time(fn)).ms);
    row[mode] = { first: first.ms, warm: median(warm), ok: !first.err && check(first.out) };
  }
  return row;
}

const { default: getActiveWindow } = await import('../automation/system/getActiveWindow.js');
const { default: getSystemMetrics } = await import('../automation/system/getSystemMetrics.js');
const { default: getUIElements } = await import('../tools/system/getUIElements.js');
const { default: ocrSearch } = await import('../tools/system/ocrSearch.js');
const { default: locateUIElement } = await import('../tools/system/locateUIElement.js');

const rows = [];
rows.push(await measure('active window', () => getActiveWindow(), (r) => r && r.appName !== 'unknown'));
rows.push(await measure('screen size', () => getSystemMetrics(), (r) => r && r.width > 0));
rows.push(await measure('UI tree (foreground app)', () => getUIElements({ foregroundOnly: true, maxElements: 300 }), (r) => r.success && r.elements.length > 0));
rows.push(await measure(`OCR find "${target}"`, () => ocrSearch({ query: target }), (r) => r === null || r.x > 0));
rows.push(await measure(`locate "${target}" (UIA, then OCR)`, () => locateUIElement({ description: target }), (r) => r && (r.success || /not found/i.test(r.error || ''))));

psWorker.enabled = true;
const ping = await psWorker.request('ping').catch((e) => ({ error: e.message }));
psWorker.dispose();

console.log = log;
log('\nClick-speed benchmark: median of ' + RUNS + ' warm runs (first run in brackets)\n');
log('step'.padEnd(36) + 'old (one-shot)'.padEnd(26) + 'new (worker)'.padEnd(26) + 'speed-up');
for (const r of rows) {
  const cell = (m) => `${fmt(m.warm)} (${fmt(m.first)})${m.ok ? '' : ' ✗'}`.padEnd(26);
  const x = r.new.warm > 0 ? `${(r.old.warm / r.new.warm).toFixed(1)}x` : '-';
  log(r.name.padEnd(36) + cell(r.old) + cell(r.new) + x);
}
log('\nworker: ' + (ping.pong ? `ok (PowerShell ${ping.ps})` : `NOT working: ${ping.error}`));
log('A ✗ means that step did not give a sensible answer (e.g. the word is not on screen); the timing is still valid.');
