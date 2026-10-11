/**
 * Click-path speed/accuracy tests using a fake persistent worker: node _tests/clickpath.mjs
 * (Needs `npm install` for the `open` package pulled in by some tools.)
 */
import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { psWorker } from '../automation/system/psWorker.js';
import { screenChanged, cachedReader } from '../tools/system/screenCache.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.USERPROFILE = process.env.USERPROFILE || '/tmp';   // locateUIElement builds a temp path from this (Windows variable)
// Point the shared worker at the fake one.
psWorker.dispose();
psWorker.command = process.execPath;
psWorker.args = [path.join(here, 'fixtures', 'fakeWorker.mjs')];
psWorker.enabled = true;
const origWarn = console.warn; console.warn = () => {};
const origLog = console.log;
const origErr = console.error;
const quiet = (fn) => async () => { console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = origLog; console.error = origErr; } };

const { default: getActiveWindow } = await import('../automation/system/getActiveWindow.js');
const { default: getSystemMetrics } = await import('../automation/system/getSystemMetrics.js');
const { default: getUIElements } = await import('../tools/system/getUIElements.js');
const { default: ocrSearch } = await import('../tools/system/ocrSearch.js');
const { default: locateUIElement } = await import('../tools/system/locateUIElement.js');
const { captureUIVisualSignature } = await import('../tools/system/uiVisualSignature.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await quiet(fn)(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}
const stats = () => psWorker.request('stats');

console.log('\nWorker-backed lookups');
await test('active window and screen size come from the worker', async () => {
  const w = await getActiveWindow();
  assert.equal(w.appName, 'notepad');
  assert.deepEqual(await getSystemMetrics(), { width: 1920, height: 1080 });
});
await test('UI tree: second read is served from cache; an action clears it', async () => {
  screenChanged();
  const before = (await stats()).uia || 0;
  const a = await getUIElements({ foregroundOnly: true, maxElements: 300 });
  const b = await getUIElements({ foregroundOnly: true, maxElements: 300 });
  assert.equal(a.success, true);
  assert.equal(((await stats()).uia || 0) - before, 1, 'one worker call for two reads');
  screenChanged();
  await getUIElements({ foregroundOnly: true, maxElements: 300 });
  assert.equal(((await stats()).uia || 0) - before, 2, 'fresh read after the screen changed');
});
await test('callers get independent copies of the element list', async () => {
  screenChanged();
  const a = await getUIElements({ foregroundOnly: true });
  a.elements.length = 0;
  const b = await getUIElements({ foregroundOnly: true });
  assert.ok(b.elements.length > 0);
});
await test('simultaneous identical reads share one worker call', async () => {
  screenChanged();
  const before = (await stats()).uia || 0;
  await Promise.all([1, 2, 3, 4].map(() => getUIElements({ foregroundOnly: true, maxElements: 111 })));
  assert.equal(((await stats()).uia || 0) - before, 1);
});
await test('visual signature goes through the worker', async () => {
  const sig = await captureUIVisualSignature([{ label: 'Save', x: 130, y: 75, width: 60, height: 30 }]);
  assert.equal(sig[0].label, 'Save');
});

console.log('\nOCR');
await test('finds the word (not the line centre); absent text returns null', async () => {
  screenChanged();
  const hit = await ocrSearch({ query: 'settings' });
  assert.deepEqual([hit.x, hit.y, hit.source], [130, 510, 'OCR']);
  assert.equal(await ocrSearch({ query: 'goodbye' }), null);
});
await test('several lookups on one screen read it with OCR once', async () => {
  screenChanged();
  const before = (await stats()).ocr || 0;
  await ocrSearch({ query: 'home' }); await ocrSearch({ query: 'about' }); await ocrSearch({ query: 'nothing' });
  assert.equal(((await stats()).ocr || 0) - before, 1);
});

console.log('\nlocateUIElement');
await test('UIA tier now finds a button INSIDE the app (it used to see only top-level windows)', async () => {
  screenChanged();
  const r = await locateUIElement({ description: 'click the Save button' });
  assert.equal(r.success, true);
  assert.equal(r.source, 'UIA');
  assert.equal(r.label, 'Save');            // not "Save As"
  assert.deepEqual([r.x, r.y], [130, 75]);
});
await test('a UIA hit does not start OCR (the slow tier)', async () => {
  screenChanged();
  const before = (await stats()).ocr || 0;
  await locateUIElement({ description: 'File' });
  assert.equal(((await stats()).ocr || 0) - before, 0);
});
await test('text that is not a control falls through to OCR and is found', async () => {
  screenChanged();
  const r = await locateUIElement({ description: 'Settings' });
  assert.equal(r.source, 'OCR');
  assert.deepEqual([r.x, r.y], [130, 510]);
});
await test('goal-name strings are still rejected quickly', async () => {
  const r = await locateUIElement({ description: 'open_and_play_song' });
  assert.equal(r.success, false);
});

console.log('\nFallbacks');
await test('worker down: lookups degrade to the old path instead of throwing', async () => {
  psWorker.enabled = false;
  screenChanged();
  const r = await getUIElements({ foregroundOnly: true });     // old PowerShell path: not available on Linux
  assert.equal(r.success, false);
  const w = await getActiveWindow();                            // old path fallback value
  assert.equal(w.appName, 'unknown');
  psWorker.enabled = true;
});
await test('cachedReader: failures and invalidated in-flight results are not kept', async () => {
  let n = 0, release;
  const read = cachedReader(() => { n++; return new Promise((r) => { release = r; }); }, { ttlMs: 1000 });
  const p = read('k');
  screenChanged();                    // invalidated while the read was in flight
  release({ v: 1 });
  await p;
  const p2 = read('k'); release({ v: 2 }); await p2;
  assert.equal(n, 2, 'the stale in-flight result was not reused');
});

psWorker.dispose();
console.warn = origWarn;
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
