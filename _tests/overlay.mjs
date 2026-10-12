/** Overlay placement across monitors + "move to the other monitor": node _tests/overlay.mjs */
import assert from 'assert/strict';
import { electronDisplays, planOverlayMove, refitBounds, applyBounds } from '../ipc/overlayPlacement.js';
import { fastIntentHandler } from '../brain/orchestrator/loop/fastPath.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ')}`); failed++; }
}

// Laptop: 2560x1440 physical at 150 % = 1707x960 DIPs (primary). External on its LEFT: 1920x1080 at 100 %.
// physical origin -> dip origin, scale
const MON = [
  { id: 1, primary: true,  phys: { x: 0, y: 0 },       scale: 1.5, bounds: { x: 0, y: 0, width: 1707, height: 960 },        workArea: { x: 0, y: 0, width: 1707, height: 920 } },
  { id: 2, primary: false, phys: { x: -1920, y: -200 }, scale: 1,   bounds: { x: -1920, y: -200, width: 1920, height: 1080 }, workArea: { x: -1920, y: -200, width: 1920, height: 1040 } },
];
const fakeScreen = (list = MON) => ({
  getAllDisplays: () => list,
  getPrimaryDisplay: () => list.find((d) => d.primary),
  // physical -> DIP, per monitor
  screenToDipPoint: (p) => {
    const d = list.find((m) => {
      const w = m.bounds.width * m.scale, h = m.bounds.height * m.scale;
      return p.x >= m.phys.x && p.x < m.phys.x + w && p.y >= m.phys.y && p.y < m.phys.y + h;
    }) || list[0];
    return { x: Math.round(d.bounds.x + (p.x - d.phys.x) / d.scale), y: Math.round(d.bounds.y + (p.y - d.phys.y) / d.scale) };
  },
});
const onLaptop = { x: 0, y: 0, width: 1707, height: 920 };
const onExternal = { x: -1920, y: -200, width: 1920, height: 1040 };

console.log('\nPlacing the overlay');
await test('electron displays are read in DIP space, sorted left to right', () => {
  const d = electronDisplays(fakeScreen());
  assert.deepEqual(d.map((x) => [x.x, x.width, x.primary]), [[-1920, 1920, false], [0, 1707, true]]);
});
await test('a point on the same monitor stays in the window, as window-local DIPs', () => {
  // physical (1500, 900) on the 150 % laptop = DIP (1000, 600)
  const plan = planOverlayMove(fakeScreen(), onLaptop, { x: 1500, y: 900, anchor: 'near' });
  assert.equal(plan.bounds, null);
  assert.deepEqual(plan.command, { x: 1000, y: 600, anchor: 'near', local: true });
});
await test('a point on the left monitor makes the window hop there; position is local to the new window', () => {
  // physical (-1000, 100) = DIP (-1000, 100); window will sit at (-1920, -200)
  const plan = planOverlayMove(fakeScreen(), onLaptop, { x: -1000, y: 100 });
  assert.deepEqual(plan.bounds, onExternal);
  assert.deepEqual(plan.command, { x: 920, y: 300, local: true });
});
await test('and back again', () => {
  const plan = planOverlayMove(fakeScreen(), onExternal, { x: 300, y: 300 });
  assert.deepEqual(plan.bounds, onLaptop);
  assert.deepEqual([plan.command.x, plan.command.y], [200, 200]);
});
await test('named positions pass straight through', () => {
  assert.deepEqual(planOverlayMove(fakeScreen(), onLaptop, 'top left'), { bounds: null, command: 'top left' });
});
await test('"other monitor" hops to the neighbour and centres; nothing that way = no move', () => {
  const next = planOverlayMove(fakeScreen(), onLaptop, { display: 'next' });
  assert.deepEqual(next.bounds, onExternal);
  assert.equal(next.command, 'center');
  const left = planOverlayMove(fakeScreen(), onLaptop, { display: 'left' });
  assert.deepEqual(left.bounds, onExternal);
  const right = planOverlayMove(fakeScreen(), onLaptop, { display: 'right' });
  assert.equal(right.command, null);
  assert.match(right.note, /right/);
});
await test('single monitor: "other monitor" does nothing, clicks still place Rocky', () => {
  const one = fakeScreen([MON[0]]);
  assert.equal(planOverlayMove(one, onLaptop, { display: 'next' }).command, null);
  assert.equal(planOverlayMove(one, onLaptop, { x: 30, y: 30 }).bounds, null);
});
await test('bad positions are ignored', () => {
  assert.equal(planOverlayMove(fakeScreen(), onLaptop, { x: NaN, y: 1 }).command, null);
});

console.log('\nKeeping the overlay on screen');
await test('already fitted: nothing to do', () => assert.equal(refitBounds(fakeScreen(), onExternal), null));
await test('monitor unplugged: the window returns to the primary monitor', () => {
  assert.deepEqual(refitBounds(fakeScreen([MON[0]]), onExternal), onLaptop);
});
await test('resolution changed: the window is resized to the new work area', () => {
  const changed = [{ ...MON[0], workArea: { x: 0, y: 0, width: 1707, height: 900 } }, MON[1]];
  assert.deepEqual(refitBounds(fakeScreen(changed), onLaptop), { x: 0, y: 0, width: 1707, height: 900 });
});
await test('applyBounds sets twice (cross-DPI quirk) and skips null/destroyed windows', () => {
  const calls = [];
  applyBounds({ setBounds: (b) => calls.push(b), isDestroyed: () => false }, onLaptop);
  assert.equal(calls.length, 2);
  applyBounds({ setBounds: () => calls.push('x'), isDestroyed: () => true }, onLaptop);
  applyBounds(null, onLaptop); applyBounds({ setBounds: () => calls.push('y') }, null);
  assert.equal(calls.length, 2);
});

console.log('\nVoice command');
await test('"move to the other monitor" and friends', () => {
  const dir = (t) => fastIntentHandler(t)?.moveDisplay;
  assert.equal(dir('move to the other monitor'), 'next');
  assert.equal(dir('go to my left screen'), 'left');
  assert.equal(dir('switch to the next display'), 'next');
  assert.equal(dir('move to the right monitor'), 'right');
  assert.equal(dir('jump to the upper screen'), 'up');
  assert.equal(dir('move to monitor'), 'next');
});
await test('existing move commands are untouched', () => {
  assert.equal(fastIntentHandler('move to top left').moveCommand, 'top left');
  assert.equal(fastIntentHandler('open my screen settings'), null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
