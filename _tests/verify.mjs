/**
 * Success-check tests (no dependencies, synthetic screens): node _tests/verify.mjs
 */
import assert from 'assert/strict';
import { encodePng, decodePng, isPng } from '../automation/system/png.js';
import { makeFingerprint } from '../tools/system/screenProbe.js';
import {
  beginClickVerification, finishClickVerification, diffFingerprints, buildNoiseMask,
} from '../tools/system/verifyExecution.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

// ── tiny fake screen ─────────────────────────────────────────────────────────
const W = 1920, H = 1080;
function screen(bg = 40) {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = bg; data[i * 4 + 1] = bg; data[i * 4 + 2] = bg; data[i * 4 + 3] = 255; }
  const f = { width: W, height: H, data };
  f.rect = (x, y, w, h, v) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = (yy * W + xx) * 4; data[i] = v; data[i + 1] = v; data[i + 2] = v;
    }
    return f;
  };
  f.clone = () => ({ ...f, data: new Uint8Array(data), rect: undefined, clone: undefined });
  return f;
}
const base = () => screen(40).rect(100, 100, 600, 400, 200); // a "window"

/** Fake capture() that serves frames in order, repeating the last. */
function frames(...list) {
  let i = 0;
  const capture = async () => list[Math.min(i++, list.length - 1)];
  capture.calls = () => i;
  return capture;
}
const clock = () => { let t = 0; const now = () => t; const sleep = async (ms) => { t += ms; }; return { now, sleep }; };

const CLICK = { x: 960, y: 540 };

console.log('\nPNG decoding');
await test('round-trips every PNG filter type', () => {
  const w = 7, h = 5;
  const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 37 + (i >> 3) * 11) & 255);
  for (const filterType of [0, 1, 2, 3, 4]) {
    const out = decodePng(encodePng(w, h, rgba, { filterType }));
    assert.equal(out.width, w); assert.equal(out.height, h);
    assert.deepEqual(Array.from(out.data), Array.from(rgba), `filter ${filterType}`);
  }
});
await test('rejects non-PNG data (e.g. a JPEG) instead of guessing', () => {
  assert.ok(!isPng(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0])));
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG/);
});

console.log('\nClick verification');
await test('detects a window opening (large change)', async () => {
  const c = clock();
  const s = await beginClickVerification(CLICK, { capture: frames(base(), base()), sleep: c.sleep });
  s.capture = frames(base().rect(400, 300, 800, 500, 255));
  const r = await finishClickVerification(s, { sleep: c.sleep, now: c.now });
  assert.equal(r.verdict, 'changed');
});
await test('detects a small checkbox toggling right at the click', async () => {
  const c = clock();
  const s = await beginClickVerification(CLICK, { capture: frames(base(), base()), sleep: c.sleep });
  s.capture = frames(base().rect(955, 535, 12, 12, 250));
  const r = await finishClickVerification(s, { sleep: c.sleep, now: c.now });
  assert.equal(r.verdict, 'changed');
  assert.ok(r.localBlocks >= 1);
});
await test('nothing changes -> unchanged, after waiting the full time', async () => {
  const c = clock();
  const s = await beginClickVerification(CLICK, { capture: frames(base(), base()), sleep: c.sleep });
  s.capture = frames(base());
  const r = await finishClickVerification(s, { timeoutMs: 1500, intervalMs: 150, sleep: c.sleep, now: c.now });
  assert.equal(r.verdict, 'unchanged');
  assert.ok(r.waitedMs >= 1500);
});
await test('slow UI: a change that appears on the 5th look still counts', async () => {
  const c = clock();
  const s = await beginClickVerification(CLICK, { capture: frames(base(), base()), sleep: c.sleep });
  const same = base(), later = base().rect(400, 300, 800, 500, 255);
  s.capture = frames(same, same, same, same, later);
  const r = await finishClickVerification(s, { sleep: c.sleep, now: c.now });
  assert.equal(r.verdict, 'changed');
  assert.ok(r.waitedMs >= 600 && r.waitedMs < 1500, `waited ${r.waitedMs}`);
});
await test('animation already running before the click is ignored (spinner)', async () => {
  const c = clock();
  const spinA = base().rect(1500, 100, 40, 40, 255);
  const spinB = base().rect(1500, 100, 40, 40, 60);
  const s = await beginClickVerification(CLICK, { capture: frames(spinA, spinB), sleep: c.sleep });
  s.capture = frames(base().rect(1500, 100, 40, 40, 255), base().rect(1500, 100, 40, 40, 150));
  const r = await finishClickVerification(s, { sleep: c.sleep, now: c.now });
  assert.equal(r.verdict, 'unchanged', JSON.stringify(r));
});
await test('a blinking text caret far from the click is not a change', async () => {
  const c = clock();
  const s = await beginClickVerification(CLICK, { capture: frames(base(), base()), sleep: c.sleep });
  s.capture = frames(base().rect(300, 200, 2, 16, 0)); // caret turns on
  const r = await finishClickVerification(s, { sleep: c.sleep, now: c.now });
  assert.equal(r.verdict, 'unchanged', JSON.stringify(r));
});
await test('foreground window change counts even if pixels look the same', async () => {
  const c = clock();
  const s = await beginClickVerification(CLICK, { capture: frames(base(), base()), sleep: c.sleep });
  s.capture = frames(base());
  const r = await finishClickVerification(s, { sleep: c.sleep, now: c.now, windowChanged: async () => true });
  assert.equal(r.verdict, 'changed');
  assert.match(r.reason, /window/);
});
await test('unknown (not failure) when the screen cannot be captured', async () => {
  const c = clock();
  const bad = async () => { throw new Error('no display'); };
  assert.equal(await beginClickVerification(CLICK, { capture: bad, sleep: c.sleep }), null);
  assert.equal((await finishClickVerification(null)).verdict, 'unknown');
  const s = await beginClickVerification(CLICK, { capture: frames(base(), base()), sleep: c.sleep });
  s.capture = bad;
  const r = await finishClickVerification(s, { sleep: c.sleep, now: c.now });
  assert.equal(r.verdict, 'unknown');
});
await test('scaled display: click coordinates are mapped onto the capture', async () => {
  const c = clock();
  // Logical screen 1280x720, capture 1920x1080 (150% scaling). Click at logical (640, 360) = capture (960, 540).
  const s = await beginClickVerification({ x: 640, y: 360 }, { screen: { width: 1280, height: 720 }, capture: frames(base(), base()), sleep: c.sleep });
  assert.equal(Math.round(s.framePoint.x), 960);
  s.capture = frames(base().rect(955, 535, 12, 12, 250));
  assert.equal((await finishClickVerification(s, { sleep: c.sleep, now: c.now })).verdict, 'changed');
});
await test('invalid click position is skipped (unknown)', async () => {
  assert.equal(await beginClickVerification({ x: -1, y: -1 }, { capture: frames(base()), sleep: clock().sleep }), null);
});

console.log('\nTools report real failures (not failure text marked as success)');
import fs from 'fs';
import os from 'os';
import path from 'path';
import ToolManager from '../tools/toolManager.js';

const tm = new ToolManager();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-home-'));
fs.mkdirSync(path.join(home, 'Desktop'));
process.env.USERPROFILE = home;
const { default: createFileWithContent } = await import('../tools/system/createFileWithContent.js');
const { default: openFile } = await import('../tools/system/openFile.js');
const { default: calculate } = await import('../tools/system/calculate.js');
tm.registerTool('createFileWithContent', createFileWithContent);
tm.registerTool('openFile', openFile);
tm.registerTool('calculate', calculate);

await test('createFileWithContent: really writes the file and says so', async () => {
  const r = await tm.execute('createFileWithContent', { fileName: 'note.txt', content: 'héllo wörld' });
  assert.equal(r.success, true);
  assert.equal(fs.readFileSync(path.join(home, 'Desktop', 'note.txt'), 'utf8'), 'héllo wörld');
});
await test('createFileWithContent: missing name is a failure, not a success message', async () => {
  const r = await tm.execute('createFileWithContent', { content: 'x' });
  assert.equal(r.success, false);
  assert.match(r.error, /file name/);
});
await test('createFileWithContent: an unwritable location is a failure', async () => {
  const r = await tm.execute('createFileWithContent', { fileName: 'no/such/dir/x.txt', content: 'x' });
  assert.equal(r.success, false);
});
await test('openFile: a file that does not exist is a failure', async () => {
  const r = await tm.execute('openFile', { fileName: 'ghost.txt' });
  assert.equal(r.success, false);
  assert.match(r.error, /cannot find/);
});
await test('calculate: bad expressions fail; good ones succeed', async () => {
  assert.equal((await tm.execute('calculate', { expression: '2+2' })).success, true);
  assert.equal((await tm.execute('calculate', { expression: '1/0' })).success, false);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
