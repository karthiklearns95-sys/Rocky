/**
 * Avatar mood-layer tests (needs `npm install` for three): node _tests/avatar.mjs
 */
import assert from 'assert/strict';
import * as THREE from 'three';
import RockyAnimationController, { MOOD_STYLE } from '../ui/components/Rocky/RockyAnimationController.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

function rig() {
  const body = new THREE.Object3D();
  new THREE.Object3D().add(body);
  const glow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ emissive: 0xcc4400, emissiveIntensity: 0.4 }));
  const limbs = Array.from({ length: 5 }, () => ({ upper: new THREE.Object3D(), lower: new THREE.Object3D() }));
  const c = new RockyAnimationController(body, glow, limbs);
  const run = (frames, state = 'idle') => { c.setState(state); for (let i = 0; i < frames; i++) c.update(1 / 60, null); };
  return { c, body, glow, limbs, run };
}

console.log('\nAvatar mood layer');

test('every mood the engine can produce has a visual style', () => {
  for (const m of ['neutral', 'happy', 'proud', 'excited', 'curious', 'worried', 'sleepy']) assert.ok(MOOD_STYLE[m], m);
});
test('unknown mood falls back to neutral', () => {
  const { c } = rig(); c.setMood('grumpy'); assert.equal(c.mood, 'neutral');
});
test('glow colour moves toward the mood colour; sleepy is dimmer than excited', () => {
  const a = rig(); a.c.setMood('excited'); a.run(240);
  const b = rig(); b.c.setMood('sleepy'); b.run(240);
  const lum = (g) => g.material.emissive.r + g.material.emissive.g + g.material.emissive.b;
  assert.ok(lum(a.glow) > lum(b.glow));
  const cyan = rig(); cyan.c.setMood('curious'); cyan.run(300);
  assert.ok(cyan.glow.material.emissive.b > cyan.glow.material.emissive.r, 'curious is bluish');
});
test('proud stands taller than sleepy while idle', () => {
  const a = rig(); a.c.setMood('proud'); a.run(60);
  const b = rig(); b.c.setMood('sleepy'); b.run(60);
  assert.ok(a.body.position.y > b.body.position.y);
});
test('curious tilts the head; neutral does not', () => {
  const a = rig(); a.c.setMood('curious'); a.run(120);
  const b = rig(); b.run(120);
  assert.ok(a.body.rotation.z > 0.15);
  assert.ok(Math.abs(b.body.rotation.z) < 0.01);
});
test('worried trembles and tucks his legs, then re-centres when calm', () => {
  const { c, body, limbs, run } = rig();
  c.setMood('worried'); run(120);
  assert.ok(limbs[0].upper.rotation.z > Math.PI / 3 + 0.1, 'legs tucked beyond the normal idle pose');
  c.setMood('neutral'); run(120);
  assert.ok(Math.abs(body.position.x) < 0.005, 'back to centre');
});
test('mood does not disturb speaking or walking poses (no runaway offsets)', () => {
  const { c, body, run } = rig();
  c.setMood('excited');
  run(600, 'moving');
  assert.ok(body.position.y < 0.3, `y stayed bounded: ${body.position.y}`);
  run(600, 'listening');
  assert.ok(body.position.y < 0.3, `listening y stayed bounded: ${body.position.y}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
