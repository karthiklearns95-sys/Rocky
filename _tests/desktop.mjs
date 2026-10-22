/** Desktop click/type tools and command clean-up (found on the first real run): node _tests/desktop.mjs */
import assert from 'assert/strict';
import { desktopClick, desktopType, locateOnScreen } from '../tools/desktop/desktopController.js';
import { normalizeSpoken } from '../resolver/appLaunchPlan.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ')}`); failed++; }
}
const quiet = async (fn) => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };
const recorder = () => { const calls = []; return { calls, click: async (a) => { calls.push(['click', a.x, a.y]); return { success: true }; }, type: async (a) => { calls.push(['type', a.text]); return { success: true }; }, key: async (a) => { calls.push(['key', a.key]); return { success: true }; } }; };

console.log('\nTyping and clicking on the desktop');
await test('a field that cannot be found means NOTHING is typed (it once typed + Enter into a terminal)', async () => {
  const r = recorder();
  const out = await quiet(() => desktopType({ query: 'Search box', text: 'hello world', pressEnter: true }, { locate: async () => null, ...r }));
  assert.equal(out.success, false);
  assert.match(out.error, /typed nothing/);
  assert.deepEqual(r.calls, []);
});
await test('a UI Automation hit is the field itself: click it, then type', async () => {
  const r = recorder();
  const out = await quiet(() => desktopType({ query: 'Search', text: 'cats', pressEnter: true }, { locate: async () => ({ x: 100, y: 50, source: 'UIA', isControl: true }), ...r }));
  assert.equal(out.success, true);
  assert.deepEqual(r.calls, [['click', 100, 50], ['type', 'cats'], ['key', 'ENTER']]);
});
await test('an OCR hit is the label: click just below it', async () => {
  const r = recorder();
  await quiet(() => desktopType({ query: 'Email', text: 'a@b.c' }, { locate: async () => ({ x: 100, y: 50, source: 'OCR', isControl: false }), ...r }));
  assert.deepEqual(r.calls[0], ['click', 100, 75]);
});
await test('if the click to focus the field fails, nothing is typed', async () => {
  const r = recorder();
  const out = await quiet(() => desktopType({ query: 'Search', text: 'x' }, { locate: async () => ({ x: 1, y: 2, source: 'UIA', isControl: true }), ...r, click: async () => ({ success: false, error: 'pointer stuck' }) }));
  assert.equal(out.success, false);
  assert.equal(r.calls.length, 0);
});
await test('click: not found is a failure, found is clicked where it was found', async () => {
  const r = recorder();
  assert.equal((await quiet(() => desktopClick({ query: 'File' }, { locate: async () => null, click: r.click }))).success, false);
  const ok = await quiet(() => desktopClick({ query: 'File' }, { locate: async () => ({ x: 12, y: 34, source: 'UIA', isControl: true }), click: r.click }));
  assert.equal(ok.success, true);
  assert.deepEqual(r.calls, [['click', 12, 34]]);
});
await test('finding: UI Automation first, then Windows OCR, then Tesseract; failures fall through', async () => {
  const el = (Name, rect) => ({ Name, ControlType: 'ControlType.MenuItem', BoundingRectangle: rect, IsOffscreen: false });
  const uia = async () => ({ success: true, elements: [el('File', '10,20,40,20'), el('Edit', '60,20,40,20')] });
  const a = await locateOnScreen('File', { uia, ocr: async () => { throw new Error('should not be asked'); } });
  assert.deepEqual([a.source, a.x, a.y], ['UIA', 30, 30]);
  const b = await locateOnScreen('Settings', { uia, ocr: async () => ({ x: 5, y: 6, label: 'Settings' }) });
  assert.equal(b.source, 'OCR');
  const c = await locateOnScreen('Settings', { uia: async () => { throw new Error('no UIA'); }, ocr: async () => null, tesseract: async () => ({ x: 0, y: 0, width: 10, height: 4 }) });
  assert.deepEqual([c.source, c.x, c.y], ['Tesseract', 5, 2]);
  assert.equal(await locateOnScreen('Nope', { uia: async () => ({ success: false }), ocr: async () => null, tesseract: async () => { throw new Error('offline'); } }), null);
});

console.log('\nWhat she typed or said, cleaned up');
await test('wake word, quotes and trailing punctuation are removed', () => {
  assert.equal(normalizeSpoken('Rocky, open notepad”'), 'open notepad');
  assert.equal(normalizeSpoken('Hey Rocky open Spotify.'), 'open spotify');
  assert.equal(normalizeSpoken('“Rocky”: click File!'), 'click file');
  assert.equal(normalizeSpoken('rockyfoo bar'), 'rockyfoo bar', 'only the word "rocky" itself');
  assert.equal(normalizeSpoken("what's the time?"), "what's the time");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
