/**
 * Persistent PowerShell worker tests: node _tests/psworker.mjs
 * Uses a fake worker for behaviour; also runs the real script under PowerShell 7
 * if it is installed (set PWSH=/path/to/pwsh) for the commands that work on any OS.
 */
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PsWorker, tryWorker } from '../automation/system/psWorker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'fixtures', 'fakeWorker.mjs');
const mk = (extra = {}, env = {}) => {
  process.env.FAKE_MODE = env.FAKE_MODE || '';
  return new PsWorker({ command: process.execPath, args: [FAKE], enabled: true, ...extra });
};

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') || e.message}`); failed++; }
}
const origWarn = console.warn; console.warn = () => {};   // keep output readable

console.log('\nPsWorker');

await test('round trip; stray output lines are ignored', async () => {
  const w = mk();
  try { assert.deepEqual(await w.request('echo', { a: 1, text: 'héllo "q" $(x)' }), { a: 1, text: 'héllo "q" $(x)' }); }
  finally { w.dispose(); }
});
await test('starts once and reuses the same process', async () => {
  const w = mk();
  try {
    const a = await w.request('pid'), b = await w.request('pid'), c = await w.request('pid');
    assert.equal(a, b); assert.equal(b, c);
  } finally { w.dispose(); }
});
await test('concurrent requests are answered correctly and in order', async () => {
  const w = mk();
  try {
    const out = await Promise.all([1, 2, 3, 4, 5].map((n) => w.request('echo', { n })));
    assert.deepEqual(out.map((o) => o.n), [1, 2, 3, 4, 5]);
  } finally { w.dispose(); }
});
await test('a worker-reported error rejects that request only', async () => {
  const w = mk();
  try {
    await assert.rejects(w.request('fail'), /it broke/);
    assert.deepEqual(await w.request('echo', { ok: 1 }), { ok: 1 });
  } finally { w.dispose(); }
});
await test('large reply split across many chunks arrives intact', async () => {
  const w = mk();
  try { assert.equal((await w.request('chunks')).length, 50000); }
  finally { w.dispose(); }
});
await test('timeout kills the hung worker and the next request gets a fresh one', async () => {
  const w = mk();
  try {
    const before = await w.request('pid');
    await assert.rejects(w.request('hang', {}, { timeoutMs: 300 }), /timed out/);
    const after = await w.request('pid');
    assert.notEqual(before, after, 'a new process was started');
  } finally { w.dispose(); }
});
await test('a request queued behind a hung one still succeeds', async () => {
  const w = mk();
  try {
    const hung = w.request('hang', {}, { timeoutMs: 300 });
    const next = w.request('echo', { later: true });
    await assert.rejects(hung, /timed out/);
    assert.deepEqual(await next, { later: true });
  } finally { w.dispose(); }
});
await test('crash mid-request rejects it, then recovers', async () => {
  const w = mk();
  try {
    await assert.rejects(w.request('crash'), /exited/);
    assert.deepEqual(await w.request('echo', { back: 1 }), { back: 1 });
  } finally { w.dispose(); }
});
await test('circuit breaker: repeated start-up failures stop respawning', async () => {
  let t = 1000;
  const w = mk({ maxStartFailures: 3, cooldownMs: 60000, now: () => t }, { FAKE_MODE: 'die-at-start' });
  try {
    for (let i = 0; i < 3; i++) await assert.rejects(w.request('echo'), /exited|worker/);
    assert.equal(w.isAvailable(), false, 'cooling down');
    await assert.rejects(w.request('echo'), /unavailable/);
    t += 61000;
    assert.equal(w.isAvailable(), true, 'tries again after the cooldown');
  } finally { w.dispose(); }
});
await test('worker that never says ready times out at start-up', async () => {
  const w = mk({ startupTimeoutMs: 300 }, { FAKE_MODE: 'never-ready' });
  try { await assert.rejects(w.request('echo'), /ready/); }
  finally { w.dispose(); process.env.FAKE_MODE = ''; }
});
await test('disabled worker rejects immediately; tryWorker reports instead of throwing', async () => {
  const w = mk({ enabled: false });
  assert.equal(w.isAvailable(), false);
  const r = await tryWorker('echo', {}, {}, w);
  assert.equal(r.ok, false);
  const ok = mk();
  try { assert.deepEqual(await tryWorker('echo', { v: 1 }, {}, ok), { ok: true, result: { v: 1 } }); }
  finally { ok.dispose(); }
});
await test('a missing executable fails cleanly (no crash of the caller)', async () => {
  const w = new PsWorker({ command: 'definitely-not-a-real-binary', args: [], enabled: true });
  const r = await tryWorker('echo', {}, {}, w);
  assert.equal(r.ok, false);
});

await test('the worker script is plain ASCII (Windows PowerShell 5.1 reads BOM-less files as ANSI)', () => {
  const text = fs.readFileSync(path.join(here, '..', 'automation', 'system', 'rockyWorker.ps1'), 'utf8');
  assert.ok(/^[\x00-\x7f]*$/.test(text), 'non-ASCII character found in rockyWorker.ps1');
});

const PWSH = process.env.PWSH;
if (PWSH && fs.existsSync(PWSH)) {
  console.log('\nReal rockyWorker.ps1 under PowerShell 7 (cross-platform commands only)');
  const real = () => new PsWorker({ command: PWSH, args: ['-NoProfile', '-NonInteractive', '-File', path.join(here, '..', 'automation', 'system', 'rockyWorker.ps1')], enabled: true, startupTimeoutMs: 30000 });
  await test('ping, repeated requests share one process, hostile text stays inert', async () => {
    const w = real();
    try {
      const a = await w.request('ping');
      assert.equal(a.pong, true);
      await w.request('ping'); await w.request('ping');
      await assert.rejects(w.request('nope'), /unknown command: nope/);
      assert.equal((await w.request('ping', { text: 'héllo "q" $(whoami) `x' })).pong, true);
    } finally { w.dispose(); }
  });
  await test('processes returns a list; apps/focus fail cleanly off Windows and the worker survives', async () => {
    const w = real();
    try {
      assert.ok(Array.isArray(await w.request('processes')));
      await assert.rejects(w.request('apps'), /Get-StartApps|not recognized|not recognised/);
      await assert.rejects(w.request('focus', { id: 1 }), /./);
      assert.equal((await w.request('ping')).pong, true);
    } finally { w.dispose(); }
  });
  await test('Windows-only commands fail with an error instead of hanging or killing the worker', async () => {
    const w = real();
    try {
      await assert.rejects(w.request('window'), /./);
      assert.equal((await w.request('ping')).pong, true, 'still alive afterwards');
    } finally { w.dispose(); }
  });
} else {
  console.log('\n(skipping real-PowerShell checks: set PWSH=/path/to/pwsh)');
}

console.warn = origWarn;
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
