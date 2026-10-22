/**
 * Voice tests with REAL worker threads and REAL child processes (no microphone or model needed):
 *   node _tests/voiceprocess.mjs          PWSH=/path/to/pwsh also runs the real windowsSpeech.ps1
 */
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WhisperClient } from '../voice/stt/whisperClient.js';
import { VadSupervisor } from '../voice/stt/vadSupervisor.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_LIB = path.join(here, 'fixtures', 'fakeTransformers.mjs');
const FAKE_VAD = path.join(here, 'fixtures', 'fakeVad.mjs');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 4).join('\n     ') || e.message}`); failed++; }
}
const until = (cond, ms = 8000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => cond() ? resolve() : Date.now() - t0 > ms ? reject(new Error('timed out waiting for condition')) : setTimeout(tick, 15);
  tick();
});

console.log('\nWhisper in a real worker thread');
await test('transcribes in a separate thread; model fallback works there too', async () => {
  const client = new WhisperClient({ models: ['bad-model', 'test.en'], loaderModule: FIXTURE_LIB });
  try {
    client.start();
    const r = await client.transcribe(new Float32Array(16000));
    assert.equal(r.model, 'test.en');
    assert.equal(r.text, 'n=16000 model=test.en lang=en-model', 'samples arrived intact; English-only model got no language option');
  } finally { client.stop(); }
});
await test('multilingual models are asked for English', async () => {
  const client = new WhisperClient({ models: ['test'], loaderModule: FIXTURE_LIB });
  try { client.start(); assert.match((await client.transcribe(new Float32Array(8))).text, /lang=english/); }
  finally { client.stop(); }
});
await test('while Whisper is busy the main thread keeps running (the old in-process version froze it)', async () => {
  const client = new WhisperClient({ models: ['test.en'], loaderModule: FIXTURE_LIB });
  try {
    client.start();
    await client.transcribe(new Float32Array(10));                  // model loaded
    let ticks = 0; const timer = setInterval(() => ticks++, 20);
    const slow = new Float32Array(100); slow[0] = 0.5;              // the fixture busy-loops 300 ms on this one
    const t0 = Date.now();
    await client.transcribe(slow);
    clearInterval(timer);
    assert.ok(Date.now() - t0 >= 280, 'the transcription really was slow');
    assert.ok(ticks >= 8, `main thread ticked ${ticks} times during it`);
  } finally { client.stop(); }
});
await test('no model can load: queued clips fail with NO_MODEL and the status says failed', async () => {
  const client = new WhisperClient({ models: ['bad-model'], loaderModule: FIXTURE_LIB });
  const statuses = []; client.on('status', (s) => statuses.push(s.model));
  try {
    client.start();
    await assert.rejects(client.transcribe(new Float32Array(10)), (e) => e.code === 'NO_MODEL' && /download failed/.test(e.message));
    assert.ok(statuses.includes('failed'));
  } finally { client.stop(); }
});

console.log('\nVoice process supervisor with real processes');
const makeSup = (script, extra = {}) => {
  const state = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-vad-')), 'attempts');
  const sup = new VadSupervisor({
    command: process.execPath, args: [FAKE_VAD, state, script],
    heartbeatTimeoutMs: 450, readyTimeoutMs: 2000, backoff: { baseMs: 40, maxMs: 200, factor: 2 }, ...extra,
  });
  const log = { ready: [], restarting: [], lines: [], failed: [] };
  sup.on('ready', (p) => log.ready.push(p)); sup.on('restarting', (p) => log.restarting.push(p));
  sup.on('failed', (p) => log.failed.push(p)); sup.on('line', (m) => log.lines.push(m));
  return { sup, log };
};
await test('a process that crashes twice is brought back and then stays up', async () => {
  const { sup, log } = makeSup('crash,crash,healthy');
  try {
    sup.start();
    await until(() => log.lines.some((m) => m.type === 'audio'));
    assert.equal(log.restarting.length, 2);
    assert.match(log.restarting[0].reason, /exited \(code 1/);
    assert.equal(log.ready.length, 3);
    assert.deepEqual(log.lines.find((m) => m.type === 'audio'), { type: 'audio', path: 'utt-1.wav' });
    await until(() => log.lines.filter((m) => m.type === 'heartbeat').length >= 2);
  } finally { sup.stop(); }
});
await test('a process that stays alive but goes silent is killed and replaced', async () => {
  const { sup, log } = makeSup('silent,healthy');
  try {
    sup.start();
    await until(() => log.lines.some((m) => m.type === 'audio'));
    assert.match(log.restarting[0].reason, /no heartbeat/);
  } finally { sup.stop(); }
});
await test('default microphone changes while running: a real process says so, exits, and comes back on the new device', async () => {
  const { sup, log } = makeSup('switch,healthy', { deviceSwitchDelayMs: 50 });
  try {
    sup.start();
    await until(() => log.lines.some((m) => m.type === 'audio'), 8000);
    const devices = log.lines.filter((m) => m.type === 'device').map((m) => m.name);
    assert.deepEqual(devices, ['Laptop Array', 'Headset (USB)']);
    assert.match(log.restarting[0].reason, /default microphone changed to Headset \(USB\)/);
    assert.equal(log.restarting[0].delayMs, 50);
    assert.equal(log.failed.length, 0, 'a device switch is not a failure');
    assert.equal(sup.deviceName, 'Headset (USB)');
  } finally { sup.stop(); }
});
await test('stop() really stops it: no more starts afterwards', async () => {
  const { sup, log } = makeSup('crash,crash,crash,crash,crash,crash,crash,crash');
  sup.start();
  await until(() => log.restarting.length >= 1);
  sup.stop();
  const n = log.ready.length;
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(log.ready.length, n);
});

const PWSH = process.env.PWSH;
if (PWSH && fs.existsSync(PWSH)) {
  console.log('\nThe real windowsSpeech.ps1 under PowerShell 7');
  const script = path.join(here, '..', 'voice', 'stt', 'windowsSpeech.ps1');
  await test('the script parses and is plain ASCII (Windows PowerShell 5.1 reads BOM-less files as ANSI)', async () => {
    const { execFileSync } = await import('child_process');
    const out = execFileSync(PWSH, ['-NoProfile', '-Command', `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${script}',[ref]$t,[ref]$e); $e.Count`], { env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } }).toString().trim();
    assert.equal(out, '0');
    assert.ok(/^[\x00-\x7f]*$/.test(fs.readFileSync(script, 'utf8')), 'non-ASCII character in windowsSpeech.ps1');
  });
  await test('with no usable microphone it reports no_microphone, and the supervisor retries patiently without spamming', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-ps-'));
    const sup = new VadSupervisor({
      command: PWSH, args: ['-NoProfile', '-NonInteractive', '-File', script, '-OutDir', outDir],
      spawnFn: undefined, noMicRetryMs: 300,
    });
    const failed = [], restarting = [], errors = [];
    sup.on('failed', (p) => failed.push(p)); sup.on('restarting', (p) => restarting.push(p)); sup.on('line', (m) => m.type === 'error' && errors.push(m));
    try {
      process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT = '1';
      sup.start();
      await until(() => restarting.length >= 2, 30000);
      assert.equal(failed.length, 1);
      assert.equal(failed[0].code, 'no_microphone');
      assert.equal(restarting[0].delayMs, 300);
      assert.equal(errors[0].code, 'no_microphone');
    } finally { sup.stop(); }
  });
} else {
  console.log('\n(skipping the real windowsSpeech.ps1 checks: set PWSH=/path/to/pwsh)');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
