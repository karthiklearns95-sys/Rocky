/** Multi-monitor geometry (no dependencies): node _tests/displays.mjs */
import assert from 'assert/strict';
import { encodePng } from '../automation/system/png.js';
import { captureRect, captureDisplayFrame } from '../automation/system/screenCapture.js';
import { ClickResolver } from '../brain/orchestrator/clickResolver.js';
import { mapModelPoint } from '../vision/screenImage.js';
import { zoomRegion } from '../vision/visionHandler.js';
import { beginClickVerification } from '../tools/system/verifyExecution.js';
import {
  normalizeDisplays, virtualBounds, primaryDisplay, displayAt, clampToDesktop, displayOfRect, activeDisplay,
  neighborDisplay, toLocal, toGlobal, imagePointToScreen, loadDisplays, resetDisplayCache,
} from '../automation/system/displays.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ')}`); failed++; }
}
const d = (name, x, y, width, height, primary = false) => ({ name, primary, x, y, width, height });

// A laptop screen (primary) with an external monitor to its LEFT, so the external has negative X.
const LEFT_EXTERNAL = normalizeDisplays([d('LAPTOP', 0, 0, 2560, 1440, true), d('EXT', -1920, -200, 1920, 1080)]);
const RIGHT_EXTERNAL = normalizeDisplays([d('LAPTOP', 0, 0, 1920, 1080, true), d('EXT', 1920, 0, 2560, 1440)]);
const ABOVE = normalizeDisplays([d('LAPTOP', 0, 0, 1920, 1080, true), d('TOP', 0, -1080, 1920, 1080)]);
const SINGLE = normalizeDisplays([d('ONLY', 0, 0, 1920, 1080, true)]);
const TRIPLE = normalizeDisplays([d('A', -1920, 0, 1920, 1080), d('B', 0, 0, 1920, 1080, true), d('C', 1920, 0, 1920, 1080)]);

console.log('\nDisplay list');
await test('sorted left to right; indexes assigned; negative positions kept', () => {
  assert.deepEqual(LEFT_EXTERNAL.map((x) => [x.index, x.name, x.x]), [[0, 'EXT', -1920], [1, 'LAPTOP', 0]]);
});
await test('exactly one primary even if Windows reported none; bad entries dropped; numbers coerced', () => {
  const n = normalizeDisplays([d('a', 0, 0, 800, 600), d('b', 800, 0, 800, 600), { name: 'ghost', x: 5, y: 5, width: 0, height: 0 }, { x: 'oops' }]);
  assert.equal(n.length, 2);
  assert.deepEqual(n.map((x) => x.primary), [true, false]);
  assert.deepEqual(normalizeDisplays(null), []);
  assert.equal(normalizeDisplays([{ x: '10', y: '20', width: '300', height: '200', primary: true }])[0].x, 10);
});
await test('virtual desktop bounds cover every monitor, including negative origins', () => {
  assert.deepEqual(virtualBounds(LEFT_EXTERNAL), { x: -1920, y: -200, width: 4480, height: 1640 });
  assert.deepEqual(virtualBounds(SINGLE), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal(virtualBounds([]), null);
  assert.equal(primaryDisplay(LEFT_EXTERNAL).name, 'LAPTOP');
});

console.log('\nWhich display is a point on?');
await test('inside, on edges, and on a monitor with negative coordinates', () => {
  assert.equal(displayAt(LEFT_EXTERNAL, { x: 100, y: 100 }).name, 'LAPTOP');
  assert.equal(displayAt(LEFT_EXTERNAL, { x: -1, y: 100 }).name, 'EXT');
  assert.equal(displayAt(LEFT_EXTERNAL, { x: -1920, y: -200 }).name, 'EXT');
  assert.equal(displayAt(LEFT_EXTERNAL, { x: 2559, y: 1439 }).name, 'LAPTOP');
  assert.equal(displayAt(ABOVE, { x: 500, y: -10 }).name, 'TOP');
});
await test('a point in a gap or off the desktop belongs to the nearest display, and clamps onto it', () => {
  const gap = normalizeDisplays([d('L', 0, 0, 1000, 1000, true), d('R', 1200, 0, 1000, 1000)]);
  assert.equal(displayAt(gap, { x: 1050, y: 500 }).name, 'L');
  assert.equal(displayAt(gap, { x: 1150, y: 500 }).name, 'R');
  assert.deepEqual(clampToDesktop(gap, { x: 1150, y: 500 }), { x: 1200, y: 500 });
  assert.deepEqual(clampToDesktop(gap, { x: -50, y: 2000 }), { x: 0, y: 999 });
  assert.equal(displayAt(SINGLE, { x: NaN, y: 1 }), null);
  assert.equal(displayAt([], { x: 1, y: 1 }), null);
});
await test('a window belongs to the display it mostly covers', () => {
  assert.equal(displayOfRect(LEFT_EXTERNAL, { x: -1500, y: 0, width: 1000, height: 700 }).name, 'EXT');
  assert.equal(displayOfRect(LEFT_EXTERNAL, { x: -300, y: 100, width: 1000, height: 700 }).name, 'LAPTOP', '700 px on the laptop, 300 on the external');
  assert.equal(displayOfRect(LEFT_EXTERNAL, { x: 9000, y: 9000, width: 10, height: 10 }).name, 'LAPTOP', 'off-desktop: nearest');
});
await test('the active display: foreground window first, then cursor, then primary', () => {
  const win = { bounds: { x: -1800, y: 0, width: 800, height: 600 }, isMinimized: false };
  assert.equal(activeDisplay(LEFT_EXTERNAL, { activeWindow: win }).name, 'EXT');
  assert.equal(activeDisplay(LEFT_EXTERNAL, { activeWindow: { ...win, isMinimized: true }, cursor: { x: 100, y: 100 } }).name, 'LAPTOP');
  assert.equal(activeDisplay(LEFT_EXTERNAL, { activeWindow: { bounds: { x: 0, y: 0, width: 0, height: 0 } }, cursor: { x: -10, y: 5 } }).name, 'EXT');
  assert.equal(activeDisplay(LEFT_EXTERNAL, {}).name, 'LAPTOP');
});

console.log('\nMoving between displays');
await test('left / right / up / down find the neighbour in that direction', () => {
  const [a, b, c] = TRIPLE;
  assert.equal(neighborDisplay(TRIPLE, b, 'left').name, 'A');
  assert.equal(neighborDisplay(TRIPLE, b, 'right').name, 'C');
  assert.equal(neighborDisplay(TRIPLE, a, 'left'), null, 'nothing further left');
  assert.equal(neighborDisplay(TRIPLE, c, 'right'), null);
  assert.equal(neighborDisplay(ABOVE, ABOVE.find((x) => x.name === 'LAPTOP'), 'up').name, 'TOP');
  assert.equal(neighborDisplay(ABOVE, ABOVE.find((x) => x.name === 'TOP'), 'down').name, 'LAPTOP');
  assert.equal(neighborDisplay(RIGHT_EXTERNAL, RIGHT_EXTERNAL[0], 'right').name, 'EXT');
});
await test('"next" and "previous" cycle through the displays left to right', () => {
  const [a, b, c] = TRIPLE;
  assert.equal(neighborDisplay(TRIPLE, a, 'next').name, 'B');
  assert.equal(neighborDisplay(TRIPLE, c, 'next').name, 'A', 'wraps around');
  assert.equal(neighborDisplay(TRIPLE, a, 'previous').name, 'C');
  assert.equal(neighborDisplay(SINGLE, SINGLE[0], 'next').name, 'ONLY', 'one display: stays');
});
await test('with two displays "left" from the left-most finds nothing, "next" always finds the other', () => {
  assert.equal(neighborDisplay(LEFT_EXTERNAL, LEFT_EXTERNAL[0], 'left'), null);
  assert.equal(neighborDisplay(LEFT_EXTERNAL, LEFT_EXTERNAL[1], 'next').name, 'EXT');
});

console.log('\nConverting between a captured image and the screen');
await test('local <-> global round trip on a monitor with negative coordinates', () => {
  const ext = LEFT_EXTERNAL[0];
  const screenPt = { x: -1000, y: 300 };
  const local = toLocal(ext, screenPt);
  assert.deepEqual(local, { x: 920, y: 500 });
  assert.deepEqual(toGlobal(ext, local), screenPt);
});
await test('a point found in a captured display image maps to the right screen point', () => {
  const ext = LEFT_EXTERNAL[0];                                            // origin (-1920, -200)
  assert.deepEqual(imagePointToScreen(ext, { x: 100, y: 50 }), { x: -1820, y: -150 });
  // image made at 150 % (1.5 image pixels per screen pixel): 300 px in the image = 200 on screen
  assert.deepEqual(imagePointToScreen(ext, { x: 300, y: 150 }, 1.5), { x: -1720, y: -100 });
});

console.log('\nAsking Windows');
const ok = (result) => async () => ({ ok: true, result });
const down = async () => ({ ok: false, reason: 'worker unavailable' });
await test('displays come from the worker, normalised, and are cached for a few seconds', async () => {
  resetDisplayCache();
  let calls = 0, t = 0;
  const worker = async () => { calls++; return { ok: true, result: [d('B', 1920, 0, 1920, 1080), d('A', 0, 0, 1920, 1080, true)] }; };
  const first = await loadDisplays({ worker, now: () => t });
  assert.deepEqual(first.map((x) => x.name), ['A', 'B']);
  await loadDisplays({ worker, now: () => t });
  assert.equal(calls, 1, 'cached');
  t += 11000;
  await loadDisplays({ worker, now: () => t });
  assert.equal(calls, 2, 'refreshed after the cache expired');
  await loadDisplays({ worker, now: () => t, fresh: true });
  assert.equal(calls, 3, 'fresh forces a read');
});
await test('worker down: falls back to one display of the primary screen size', async () => {
  resetDisplayCache();
  const got = await loadDisplays({ worker: down, fallback: async () => ({ width: 2560, height: 1440 }) });
  assert.deepEqual(got.map((x) => [x.width, x.height, x.primary]), [[2560, 1440, true]]);
});
await test('nothing readable: null, and a previous good answer is kept rather than lost', async () => {
  resetDisplayCache();
  assert.equal(await loadDisplays({ worker: down }), null);
  await loadDisplays({ worker: ok([d('A', 0, 0, 100, 100, true)]), fresh: true });
  const kept = await loadDisplays({ worker: down, fresh: true });
  assert.equal(kept.length, 1);
});

console.log('\nCapture and click verification on a second monitor');
const solid = (w, h, v) => encodePng(w, h, new Uint8Array(w * h * 4).fill(v));
const captureWorker = (png) => async (cmd, args) => ({ ok: true, result: { x: args.x, y: args.y, width: args.width, height: args.height, png: png.toString('base64') } });
await test('captureRect asks the worker for exactly that rectangle and decodes the PNG', async () => {
  const shot = await captureRect({ x: -1920, y: -200, width: 8, height: 6 }, { worker: captureWorker(solid(8, 6, 90)) });
  assert.deepEqual([shot.x, shot.y, shot.width, shot.height], [-1920, -200, 8, 6]);
});
await test('captureDisplayFrame returns the frame with the display origin (negative allowed)', async () => {
  const ext = LEFT_EXTERNAL[0];
  const f = await captureDisplayFrame({ ...ext, width: 8, height: 6 }, { worker: captureWorker(solid(8, 6, 90)) });
  assert.deepEqual([f.width, f.height, f.origin.x, f.origin.y], [8, 6, -1920, -200]);
});
await test('a secondary display with a dead worker throws rather than capturing the wrong screen', async () => {
  const bad = async () => ({ ok: false, error: 'down' });
  await assert.rejects(captureDisplayFrame(LEFT_EXTERNAL[0], { worker: bad, fallback: async () => solid(4, 4, 1) }), /down/);
});
await test('a primary display falls back to the plain screenshot', async () => {
  const bad = async () => ({ ok: false, error: 'down' });
  const f = await captureDisplayFrame({ ...LEFT_EXTERNAL[1], width: 4, height: 4 }, { worker: bad, fallback: async () => solid(4, 4, 1) });
  assert.equal(f.width, 4);
});
await test('click verification places a click on the left monitor relative to that monitor', async () => {
  const ext = LEFT_EXTERNAL[0]; // x -1920, y -200
  const session = await beginClickVerification({ x: -1000, y: 100 }, {
    display: ext, capture: async () => ({ width: ext.width, height: ext.height, data: new Uint8Array(ext.width * ext.height * 4) }),
    sleep: async () => {},
  });
  assert.deepEqual(session.framePoint, { x: 920, y: 300 });
});
await test('a negative-coordinate click is accepted with a display, refused without one', async () => {
  const cap = async () => ({ width: 100, height: 100, data: new Uint8Array(100 * 100 * 4) });
  assert.equal(await beginClickVerification({ x: -5, y: 5 }, { capture: cap, sleep: async () => {} }), null);
  const ok = await beginClickVerification({ x: -5, y: 5 }, { display: { x: -100, y: 0, width: 100, height: 100 }, capture: cap, sleep: async () => {} });
  assert.ok(ok);
});

console.log('\nVision answers mapped back to the desktop');
const EXT = LEFT_EXTERNAL[0]; // 1920x1080 at (-1920, -200)
await test('picture pixels on the left monitor land at negative desktop coordinates', () => {
  assert.deepEqual(mapModelPoint({ x: 100, y: 50 }, EXT, { width: 1920, height: 1080 }, { space: 'pixels' }), { x: -1820, y: -150 });
});
await test('0-1 fractions and 0-1000 values are scaled to the monitor', () => {
  assert.deepEqual(mapModelPoint({ x: 0.5, y: 0.5 }, EXT, null), { x: -960, y: 340 });
  assert.deepEqual(mapModelPoint({ x: 500, y: 500 }, EXT, null, { space: 'thousand' }), { x: -960, y: 340 });
});
await test('a picture scaled down from the monitor is scaled back up', () => {
  assert.deepEqual(mapModelPoint({ x: 480, y: 270 }, EXT, { width: 960, height: 540 }, { space: 'pixels' }), { x: -960, y: 340 });
});
await test('missing, negative or off-monitor answers are refused', () => {
  assert.equal(mapModelPoint({ x: -1, y: -1 }, EXT, null), null);
  assert.equal(mapModelPoint({}, EXT, null), null);
  assert.equal(mapModelPoint({ x: 5000, y: 10 }, EXT, null, { space: 'pixels' }), null);
});
await test('zoom region stays inside the monitor at the corners', () => {
  assert.deepEqual(zoomRegion(EXT, { x: 5, y: 5 }), { x: 0, y: 0, width: 400, height: 400 });
  assert.deepEqual(zoomRegion(EXT, { x: 1915, y: 1075 }), { x: 1520, y: 680, width: 400, height: 400 });
});
await test('a located point on a monitor left of the main one (negative x) is kept, not dropped', () => {
  const r = new ClickResolver(null);
  assert.deepEqual(r.extractLocatedPoint({ success: true, x: -800, y: 300 }).x, -800);
  assert.equal(r.extractLocatedPoint({ success: true, x: NaN, y: 3 }), null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
