/**
 * Voice pipeline tests (no microphone, model or Windows needed): node _tests/voice.mjs
 */
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { analyzeSamples, shouldTranscribe, isHallucination } from '../voice/stt/audioGate.js';
import { interpretTranscript, cleanTranscript } from '../voice/stt/transcript.js';
import { decodeWav } from '../voice/stt/wavReader.js';
import wavefilePkg from 'wavefile';
import { parseVadLine, LineBuffer } from '../voice/stt/vadProtocol.js';
import { VadSupervisor } from '../voice/stt/vadSupervisor.js';
import { WhisperClient } from '../voice/stt/whisperClient.js';
import { createTranscriber, optionsFor } from '../voice/stt/transcriberCore.js';
import SpeechToText, { removeStaleClips } from '../voice/stt/speechToText.js';
import { fakeTime } from './harness/fakeTime.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  const log = console.log; console.log = () => {};
  try { await fn(); console.log = log; console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log = log; console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 4).join('\n     ') || e.message}`); failed++; }
}
const tone = (n, amp) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 7));

// ───────────────────────────── pure pieces ─────────────────────────────
console.log('\nAudio gate');
await test('measures length and loudness', () => {
  const s = analyzeSamples(tone(16000, 0.5));
  assert.equal(s.durationMs, 1000);
  assert.ok(s.rms > 0.3 && s.rms < 0.4, `rms ${s.rms}`);
  assert.deepEqual(analyzeSamples(new Float32Array(0)), { durationMs: 0, rms: 0, peak: 0 });
});
await test('clicks and silence are not sent to Whisper', () => {
  assert.equal(shouldTranscribe(analyzeSamples(tone(2000, 0.5))).ok, false);              // 125 ms
  assert.equal(shouldTranscribe(analyzeSamples(new Float32Array(16000))).ok, false);      // 1 s of silence
  assert.equal(shouldTranscribe(analyzeSamples(tone(16000, 0.2))).ok, true);
  assert.match(shouldTranscribe(analyzeSamples(tone(2000, 0.5))).reason, /short/);
});
await test('Whisper filler: markers always, stock phrases only when the clip was quiet', () => {
  const quiet = { rms: 0.006 }, loud = { rms: 0.1 };
  for (const t of ['[BLANK_AUDIO]', '(music)', '♪', '...', '[ Silence ]', '', 'you you you you you']) assert.ok(isHallucination(t, loud), t);
  assert.ok(isHallucination('Thank you.', quiet));
  assert.ok(isHallucination('thanks for watching', quiet));
  assert.equal(isHallucination('Thank you.', loud), false, 'a real "thank you" is kept');
  assert.equal(isHallucination('open spotify', quiet), false);
});

console.log('\nTranscript interpretation');
await test('cleaning: lower case, no sentence punctuation', () => {
  assert.equal(cleanTranscript('  Hey, Rocky!  Open   Spotify. '), 'hey rocky open spotify');
  // Whisper's notes for sounds (heard on a real laptop): not words, so they are not speech.
  for (const noise of ['(clicking)', '(buzzing)', '(buzzer buzzing)', '(clippers buzzing)', '[BLANK_AUDIO]', '*clicks*', '♪ ♪', '♪ la la ♪'])
    assert.equal(cleanTranscript(noise), '', noise);
  assert.equal(cleanTranscript('(buzzing) Rocky, open notepad'), 'rocky open notepad');
});
await test('wake word with a command in the same breath', () => {
  assert.deepEqual(interpretTranscript('Hey Rocky, open Spotify.'), { kind: 'wake', text: 'hey rocky open spotify', command: 'open spotify' });
  assert.equal(interpretTranscript('Rocky').command, '');
  assert.equal(interpretTranscript('rocky play some jazz').command, 'play some jazz');
});
await test('Whisper spellings of the wake word are accepted; real words are not', () => {
  for (const w of ['Rocki', 'Rockie', 'rockey', 'Roki']) assert.equal(interpretTranscript(`${w} open notepad`).kind, 'wake', w);
  assert.equal(interpretTranscript('launch the rocket now').kind, 'ignore');
  assert.equal(interpretTranscript('rockyroad is nice').kind, 'ignore', 'only a whole word counts');
});
await test('only a short isolated stop word interrupts', () => {
  assert.equal(interpretTranscript('Stop!').kind, 'interrupt');
  assert.equal(interpretTranscript('wait').kind, 'interrupt');
  assert.equal(interpretTranscript('never mind').kind, 'interrupt');
  assert.equal(interpretTranscript('stop playing music', { listening: true }).kind, 'command');
});
await test('without the wake word, speech is a command only while Rocky is listening', () => {
  assert.deepEqual(interpretTranscript('open chrome', { listening: true }), { kind: 'command', text: 'open chrome' });
  assert.equal(interpretTranscript('open chrome', { listening: false }).kind, 'ignore');
  assert.equal(interpretTranscript('   ').kind, 'ignore');
});

console.log('\nVoice process protocol');
await test('parses every message type', () => {
  assert.deepEqual(parseVadLine('[READY]'), { type: 'ready' });
  assert.deepEqual(parseVadLine('[HEARTBEAT]'), { type: 'heartbeat' });
  assert.deepEqual(parseVadLine('[STOP]'), { type: 'stop' });
  assert.deepEqual(parseVadLine('[AUDIO] utt-1.wav'), { type: 'audio', path: 'utt-1.wav' });
  assert.deepEqual(parseVadLine('[ERROR] no_microphone No audio input device'), { type: 'error', code: 'no_microphone', message: 'No audio input device' });
  assert.equal(parseVadLine('some noise').type, 'unknown');
  assert.deepEqual(parseVadLine('[DEVICE] Headset Microphone (USB)'), { type: 'device', name: 'Headset Microphone (USB)' });
  assert.deepEqual(parseVadLine('[DEVICE]'), { type: 'device', name: '' });
  assert.deepEqual(parseVadLine('[DEVICE_CHANGED] Realtek Array'), { type: 'deviceChanged', name: 'Realtek Array' });
});
await test('lines split across chunks are reassembled (the old code lost them)', () => {
  const b = new LineBuffer();
  assert.deepEqual(b.push('[AUDIO] utt-12'), []);
  assert.deepEqual(b.push('3.wav\r\n[HEART'), ['[AUDIO] utt-123.wav']);
  assert.deepEqual(b.push('BEAT]\n[READY]\n'), ['[HEARTBEAT]', '[READY]']);
});

// ───────────────────────────── supervisor ─────────────────────────────
class FakeChild extends EventEmitter {
  constructor() { super(); this.stdout = new EventEmitter(); this.stderr = new EventEmitter(); this.killed = false; }
  line(l) { this.stdout.emit('data', Buffer.from(l + '\n')); }
  exit(code = 1, signal = null) { this.emit('exit', code, signal); }
}
function supervisor(opts = {}) {
  const clock = fakeTime();
  const children = [];
  const sup = new VadSupervisor({
    command: 'fake', spawnFn: () => { const c = new FakeChild(); children.push(c); return c; },
    killFn: (c) => { c.killed = true; c.exit(null, 'SIGKILL'); },
    now: clock.now, timers: clock.timers, ...opts,
  });
  const events = [];
  for (const e of ['ready', 'restarting', 'failed', 'stopped', 'device', 'device-changed']) sup.on(e, (p) => events.push([e, p]));
  const of = (name) => events.filter(([e]) => e === name).map(([, p]) => p);
  return { sup, clock, children, events, of };
}

console.log('\nVoice process supervisor');
await test('starts the process and reports ready', () => {
  const { sup, children, of } = supervisor();
  sup.start();
  assert.equal(children.length, 1);
  assert.equal(sup.ready, false);
  children[0].line('[READY]');
  assert.equal(sup.ready, true);
  assert.equal(of('ready').length, 1);
});
await test('restarts when the process dies, with growing pauses (1s, 2s, 4s)', async () => {
  const { sup, clock, children, of } = supervisor();
  sup.start();
  const delays = [];
  for (let i = 0; i < 3; i++) {
    children.at(-1).exit(1);
    delays.push(of('restarting').at(-1).delayMs);
    await clock.advance(of('restarting').at(-1).delayMs - 1);
    assert.equal(children.length, i + 1, 'not yet');
    await clock.advance(1);
    assert.equal(children.length, i + 2, 'restarted on time');
  }
  assert.deepEqual(delays, [1000, 2000, 4000]);
});
await test('the pause is capped, and resets after the process ran stably', async () => {
  const { sup, clock, children, of } = supervisor({ backoff: { baseMs: 1000, maxMs: 5000, factor: 2 } });
  sup.start();
  for (let i = 0; i < 6; i++) { children.at(-1).exit(1); await clock.advance(of('restarting').at(-1).delayMs); }
  assert.equal(Math.max(...of('restarting').map((r) => r.delayMs)), 5000);
  // now a healthy run of 40 s with heartbeats
  children.at(-1).line('[READY]');
  for (let i = 0; i < 8; i++) { await clock.advance(5000); children.at(-1).line('[HEARTBEAT]'); }
  children.at(-1).exit(1);
  assert.equal(of('restarting').at(-1).delayMs, 1000, 'back to the short pause');
});
await test('a silent process (no heartbeat) is killed and restarted', async () => {
  const { sup, clock, children, of } = supervisor();
  sup.start(); children[0].line('[READY]');
  await clock.advance(10000);
  assert.equal(children[0].killed, false, 'still within the allowed silence');
  await clock.advance(10000);
  assert.equal(children[0].killed, true);
  assert.match(of('restarting')[0].reason, /no heartbeat/);
  await clock.advance(1000);
  assert.equal(children.length, 2);
});
await test('heartbeats keep a healthy process alive', async () => {
  const { sup, clock, children } = supervisor();
  sup.start(); children[0].line('[READY]');
  for (let i = 0; i < 12; i++) { await clock.advance(5000); children[0].line('[HEARTBEAT]'); }
  assert.equal(children[0].killed, false);
  assert.equal(children.length, 1);
});
await test('waking from sleep restarts it (the old audio handle is dead)', async () => {
  const { sup, clock, children, of } = supervisor();
  sup.start(); children[0].line('[READY]');
  await clock.advance(5000); children[0].line('[HEARTBEAT]');
  clock.jump(8 * 60 * 1000);                      // laptop asleep: no timer ran
  await clock.advance(5000);
  assert.equal(children[0].killed, true);
  assert.match(of('restarting')[0].reason, /resumed from sleep/);
});
await test('a process that never says READY is restarted', async () => {
  const { sup, clock, children, of } = supervisor({ readyTimeoutMs: 20000 });
  sup.start();
  await clock.advance(21000);
  assert.equal(children[0].killed, true);
  assert.match(of('restarting')[0].reason, /READY/);
});
await test('no microphone: reported once, retried patiently, not counted as a crash loop', async () => {
  const { sup, clock, children, of } = supervisor({ noMicRetryMs: 20000 });
  sup.start();
  for (let i = 0; i < 4; i++) {
    children.at(-1).line('[ERROR] no_microphone No audio input device');
    children.at(-1).exit(2);
    assert.equal(of('restarting').at(-1).delayMs, 20000);
    await clock.advance(20000);
  }
  assert.equal(of('failed').length, 1, 'told Grace once, not on every attempt');
  assert.equal(of('failed')[0].code, 'no_microphone');
  assert.equal(sup.failures, 0);
  assert.equal(children.length, 5, 'and it keeps trying');
});
await test('default microphone changes: restarted at once on the new device, not counted as a failure', async () => {
  const { sup, clock, children, of } = supervisor({ deviceSwitchDelayMs: 400 });
  sup.start();
  children[0].line('[READY]');
  children[0].line('[DEVICE] Laptop Array');
  assert.equal(sup.deviceName, 'Laptop Array');
  children[0].line('[DEVICE_CHANGED] Headset (USB)');
  assert.equal(children[0].killed, true, 'old process (bound to the old device) is stopped');
  assert.deepEqual(of('device-changed'), [{ name: 'Headset (USB)' }]);
  const r = of('restarting').at(-1);
  assert.equal(r.delayMs, 400);
  assert.match(r.reason, /default microphone changed to Headset/);
  assert.equal(sup.failures, 0);
  assert.equal(of('failed').length, 0);
  await clock.advance(400);
  assert.equal(children.length, 2, 'new process started on the new device');
  children[1].line('[READY]');
  children[1].line('[DEVICE] Headset (USB)');
  assert.equal(sup.deviceName, 'Headset (USB)');
  assert.equal(sup.ready, true);
});
await test('a switch right after a crash loop does not reset or worsen the back-off', async () => {
  const { sup, clock, children } = supervisor();
  sup.start();
  children[0].exit(1); await clock.advance(1000);       // one ordinary failure
  children[1].line('[READY]'); children[1].line('[DEVICE_CHANGED] X');
  assert.equal(sup.failures, 1, 'the switch itself added no failure');
});
await test('a device that keeps flapping is treated as a fault, with back-off', async () => {
  const { sup, clock, children, of } = supervisor({ deviceFlapLimit: 3, deviceFlapWindowMs: 10000 });
  sup.start();
  for (let i = 0; i < 6; i++) {
    children.at(-1).line('[READY]');
    children.at(-1).line('[DEVICE_CHANGED] flaky');
    await clock.advance(i < 3 ? 400 : 30000);
  }
  const delays = of('restarting').map((r) => r.delayMs);
  assert.deepEqual(delays.slice(0, 3), [400, 400, 400]);
  assert.ok(delays[3] >= 1000, `4th switch inside the window backs off, got ${delays[3]}`);
  assert.ok(sup.failures > 0);
});
await test('repeated fast failures are reported once, then retried slowly forever', async () => {
  const { sup, clock, children, of } = supervisor({ maxRapidFailures: 3, backoff: { baseMs: 1000, maxMs: 30000, factor: 2 } });
  sup.start();
  for (let i = 0; i < 6; i++) { children.at(-1).exit(1); await clock.advance(of('restarting').at(-1).delayMs); }
  assert.equal(of('failed').length, 1);
  assert.equal(of('failed')[0].code, 'repeated_failure');
  assert.equal(of('restarting').at(-1).delayMs, 30000);
  assert.equal(children.length, 7);
});
await test('once it recovers and runs stably, a later outage can be reported again', async () => {
  const { sup, clock, children, of } = supervisor({ maxRapidFailures: 2 });
  sup.start();
  for (let i = 0; i < 3; i++) { children.at(-1).exit(1); await clock.advance(of('restarting').at(-1).delayMs); }
  assert.equal(of('failed').length, 1);
  children.at(-1).line('[READY]');
  for (let i = 0; i < 8; i++) { await clock.advance(5000); children.at(-1).line('[HEARTBEAT]'); }
  children.at(-1).exit(1); await clock.advance(1000);                 // stable run ended -> counters reset
  for (let i = 0; i < 3; i++) { children.at(-1).exit(1); await clock.advance(of('restarting').at(-1).delayMs); }
  assert.equal(of('failed').length, 2);
});
await test('stop() ends it for good: no restart afterwards', async () => {
  const { sup, clock, children } = supervisor();
  sup.start(); children[0].line('[READY]');
  sup.stop();
  assert.equal(children[0].killed, true);
  await clock.advance(120000);
  assert.equal(children.length, 1);
  assert.equal(clock.pending(), 0, 'no timers left running');
});
await test('messages split across chunks arrive whole', () => {
  const { sup, children } = supervisor();
  const got = []; sup.on('line', (m) => got.push(m));
  sup.start();
  children[0].stdout.emit('data', Buffer.from('[AUDIO] utt-9'));
  children[0].stdout.emit('data', Buffer.from('9.wav\n[HEARTBEAT]\n'));
  assert.deepEqual(got, [{ type: 'audio', path: 'utt-99.wav' }, { type: 'heartbeat' }]);
});
await test('a failure to even start the process is retried, not fatal', async () => {
  const clock = fakeTime(); let calls = 0;
  const sup = new VadSupervisor({ command: 'x', spawnFn: () => { calls++; if (calls < 3) throw new Error('ENOENT'); return new FakeChild(); }, now: clock.now, timers: clock.timers });
  sup.start();
  await clock.advance(1000); await clock.advance(2000);
  assert.equal(calls, 3);
});
await test('exit events from a process that was already replaced are ignored', async () => {
  const { sup, clock, children, of } = supervisor();
  sup.start(); children[0].exit(1); await clock.advance(1000);
  children[0].exit(1);                                   // late duplicate event from the old process
  assert.equal(of('restarting').length, 1);
  assert.equal(children.length, 2);
});

// ───────────────────────────── Whisper client ─────────────────────────────
class FakeWorker extends EventEmitter {
  constructor(data) { super(); this.data = data; this.sent = []; this.terminated = false; }
  postMessage(m) { this.sent.push(m); }
  terminate() { this.terminated = true; return Promise.resolve(); }
  say(msg) { this.emit('message', msg); }
}
function whisper(opts = {}) {
  const clock = fakeTime();
  const workers = [];
  const client = new WhisperClient({ models: ['m-base', 'm-tiny'], createWorker: (d) => { const w = new FakeWorker(d); workers.push(w); return w; }, now: clock.now, timers: clock.timers, ...opts });
  const statuses = []; client.on('status', (s) => statuses.push(s));
  return { client, clock, workers, statuses };
}
const rejects = async (p, code) => { try { await p; assert.fail('should have rejected'); } catch (e) { assert.equal(e.code, code, e.message); } };

console.log('\nWhisper client');
await test('clips sent while the model loads wait, then run one at a time in order', async () => {
  const { client, workers } = whisper();
  client.start();
  const a = client.transcribe(Float32Array.of(1)), b = client.transcribe(Float32Array.of(2));
  assert.equal(workers[0].sent.length, 0, 'nothing sent before the model is ready');
  workers[0].say({ type: 'ready', model: 'm-base' });
  assert.equal(workers[0].sent.length, 1, 'only one in flight');
  workers[0].say({ type: 'result', id: workers[0].sent[0].id, text: 'one', model: 'm-base' });
  assert.deepEqual(await a, { text: 'one', model: 'm-base' });
  assert.equal(workers[0].sent.length, 2);
  workers[0].say({ type: 'result', id: workers[0].sent[1].id, text: 'two', model: 'm-base' });
  assert.equal((await b).text, 'two');
});
await test('the model list (preferred first, then fallbacks) is handed to the worker', () => {
  const { client, workers } = whisper();
  client.start();
  assert.deepEqual(workers[0].data.models, ['m-base', 'm-tiny']);
});
await test('too many waiting clips: the OLDEST are dropped', async () => {
  const { client } = whisper({ maxQueue: 2 });
  client.start();
  const ps = [1, 2, 3, 4].map((n) => client.transcribe(Float32Array.of(n)));
  await rejects(ps[0], 'DROPPED'); await rejects(ps[1], 'DROPPED');
});
await test('a clip that waited too long is discarded as stale', async () => {
  const { client, clock, workers } = whisper({ maxClipAgeMs: 20000 });
  client.start();
  const old = client.transcribe(Float32Array.of(1));
  await clock.advance(30000);
  const fresh = client.transcribe(Float32Array.of(2));
  workers[0].say({ type: 'ready', model: 'm-base' });
  await rejects(old, 'STALE');
  assert.equal(workers[0].sent.length, 1);
  assert.equal(workers[0].sent[0].samples[0], 2, 'the fresh clip is the one transcribed');
  workers[0].say({ type: 'result', id: workers[0].sent[0].id, text: 'ok', model: 'm' });
  await fresh;
});
await test('a transcription that hangs kills the worker and starts a new one; a clip sent meanwhile is handled by it', async () => {
  const { client, clock, workers } = whisper({ requestTimeoutMs: 45000 });
  client.start(); workers[0].say({ type: 'ready', model: 'm-base' });
  const hung = client.transcribe(Float32Array.of(1));
  const stale = client.transcribe(Float32Array.of(9));         // queued behind it, and will have waited 46 s
  await clock.advance(45000);
  await rejects(hung, 'TIMEOUT');
  assert.equal(workers[0].terminated, true);
  const fresh = client.transcribe(Float32Array.of(2));         // Grace speaks again during the restart pause
  await clock.advance(1000);
  assert.equal(workers.length, 2);
  workers[1].say({ type: 'ready', model: 'm-base' });
  await rejects(stale, 'STALE');                               // too old to act on now
  assert.equal(workers[1].sent[0].samples[0], 2, 'the fresh clip goes to the new worker');
  workers[1].say({ type: 'result', id: workers[1].sent[0].id, text: 'fine', model: 'm-base' });
  assert.equal((await fresh).text, 'fine');
});
await test('a crash mid-transcription fails that clip and recovers', async () => {
  const { client, clock, workers } = whisper();
  client.start(); workers[0].say({ type: 'ready', model: 'm-base' });
  const p = client.transcribe(Float32Array.of(1));
  workers[0].emit('error', new Error('out of memory'));
  await rejects(p, 'WORKER');
  await clock.advance(1000);
  assert.equal(workers.length, 2);
  workers[1].say({ type: 'ready', model: 'm-base' });
  const q = client.transcribe(Float32Array.of(3));
  workers[1].say({ type: 'result', id: workers[1].sent[0].id, text: 'back', model: 'm-base' });
  assert.equal((await q).text, 'back');
});
await test('no model could be loaded: waiting clips fail, status says so, retried rarely (not every 30 s)', async () => {
  const { client, clock, workers, statuses } = whisper();
  client.start();
  const p = client.transcribe(Float32Array.of(1));
  workers[0].say({ type: 'load_failed', error: 'offline' });
  await rejects(p, 'NO_MODEL');
  assert.ok(statuses.some((s) => s.model === 'failed'));
  await clock.advance(29000); assert.equal(workers.length, 1);
  await clock.advance(1000);  assert.equal(workers.length, 2, 'first retry after 30 s');
  workers[1].say({ type: 'load_failed', error: 'offline' });
  await clock.advance(59000); assert.equal(workers.length, 2);
  await clock.advance(1000);  assert.equal(workers.length, 3, 'then 60 s, doubling');
});
await test('events from a replaced worker are ignored; stop() fails what is waiting', async () => {
  const { client, workers } = whisper();
  client.start();
  const p = client.transcribe(Float32Array.of(1));
  client.stop();
  await rejects(p, 'STOPPED');
  workers[0].say({ type: 'ready', model: 'x' });               // late message from the stopped worker
  await rejects(client.transcribe(Float32Array.of(2)), 'STOPPED');
  assert.equal(workers[0].terminated, true);
});
await test('status events: loading, then ready with the model name', () => {
  const { client, workers, statuses } = whisper();
  client.start(); workers[0].say({ type: 'ready', model: 'm-base' });
  assert.deepEqual(statuses.map((s) => s.model), ['loading', 'ready']);
  assert.equal(statuses.at(-1).name, 'm-base');
});

console.log('\nModel loading (fallbacks)');
await test('falls back to the next model when the preferred one cannot load', async () => {
  const tried = [];
  const t = createTranscriber({ models: ['big', 'small'], loadPipeline: async (m) => { tried.push(m); if (m === 'big') throw new Error('download failed'); return async () => ({ text: ' hi ' }); } });
  assert.deepEqual(await t.transcribe(Float32Array.of(1)), { text: 'hi', model: 'small' });
  assert.deepEqual(tried, ['big', 'small']);
  await t.transcribe(Float32Array.of(1));
  assert.deepEqual(tried, ['big', 'small'], 'loaded once');
});
await test('if nothing loads it says so, and a later attempt can still succeed', async () => {
  let up = false;
  const t = createTranscriber({ models: ['a'], loadPipeline: async () => { if (!up) throw new Error('offline'); return async () => ({ text: 'ok' }); } });
  await assert.rejects(t.transcribe(Float32Array.of(1)), /no speech model could be loaded \(offline\)/);
  up = true;
  assert.equal((await t.transcribe(Float32Array.of(1))).text, 'ok');
});
await test('English-only models get no language option (it would be rejected); multilingual ones do', () => {
  assert.equal('language' in optionsFor('Xenova/whisper-base.en'), false);
  assert.equal(optionsFor('Xenova/whisper-small').language, 'english');
});

// ───────────────────────────── SpeechToText (wiring) ─────────────────────────────
function rig({ transcript = 'rocky open spotify', samples = tone(16000, 0.2), whisperError = null, startState = 'idle' } = {}) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-stt-'));
  const bus = new EventEmitter(); const emitted = [];
  const realEmit = bus.emit.bind(bus); bus.emit = (e, p) => { emitted.push([e, p]); return realEmit(e, p); };
  let st = startState;
  const state = { getState: () => st, setState: (s) => { st = s; } };
  const vad = Object.assign(new EventEmitter(), { start() { this.started = true; }, stop() { this.stopped = true; } });
  const calls = [];
  const w = Object.assign(new EventEmitter(), {
    start() { this.started = true; }, stop() { this.stopped = true; },
    async transcribe(s) { calls.push(s.length); if (whisperError) throw whisperError; return { text: transcript, model: 'm' }; },
  });
  const stt = new SpeechToText({ config: { model: 'm', wakeWord: 'rocky', minSpeechMs: 350, minRms: 0.004, quietRms: 0.012 }, eventBus: bus, stateManager: state, vad, whisper: w, outDir, readWav: async () => samples, log: () => {} });
  stt.isListening = true;
  const clip = () => { const f = path.join(outDir, `utt-${Math.random().toString(16).slice(2)}.wav`); fs.writeFileSync(f, 'RIFF'); return f; };
  const ev = (name) => emitted.filter(([e]) => e === name).map(([, p]) => p);
  return { stt, vad, w, bus, state, outDir, clip, emitted, ev, calls, st: () => st };
}

console.log('\nSpeechToText');
await test('"Rocky, open Spotify" -> wake + command, clip deleted', async () => {
  const r = rig(); const f = r.clip();
  const res = await r.stt.processAudioFile(f);
  assert.equal(res.outcome, 'wake');
  assert.deepEqual(r.ev('USER_INPUT'), ['open spotify']);
  assert.equal(r.st(), 'listening');
  assert.equal(fs.existsSync(f), false);
});
await test('wake word alone: starts listening; the next phrase is the command', async () => {
  const r = rig({ transcript: 'Rocky.' });
  await r.stt.processAudioFile(r.clip());
  assert.equal(r.st(), 'listening'); assert.deepEqual(r.ev('USER_INPUT'), []);
  r.w.transcribe = async () => ({ text: 'Play some jazz.', model: 'm' });
  await r.stt.processAudioFile(r.clip());
  assert.deepEqual(r.ev('USER_INPUT'), ['play some jazz']);
  assert.equal(r.st(), 'idle');
});
await test('speech without the wake word is ignored while idle', async () => {
  const r = rig({ transcript: 'what a lovely day' });
  assert.equal((await r.stt.processAudioFile(r.clip())).outcome, 'ignore');
  assert.deepEqual(r.ev('USER_INPUT'), []);
});
await test('a stop word aborts what Rocky is doing', async () => {
  const r = rig({ transcript: 'Stop!', startState: 'listening' });
  await r.stt.processAudioFile(r.clip());
  assert.equal(r.ev('ABORT_EXECUTION').length, 1);
  assert.equal(r.st(), 'idle');
});
await test('silence and clicks never reach Whisper (and the clip is still deleted)', async () => {
  const quiet = rig({ samples: new Float32Array(16000) }); const f1 = quiet.clip();
  assert.match((await quiet.stt.processAudioFile(f1)).outcome, /quiet/);
  const short = rig({ samples: tone(1000, 0.5) }); const f2 = short.clip();
  assert.match((await short.stt.processAudioFile(f2)).outcome, /short/);
  assert.deepEqual(quiet.calls.concat(short.calls), []);
  assert.equal(fs.existsSync(f1) || fs.existsSync(f2), false);
});
await test('Whisper filler on a quiet clip is ignored, even while listening', async () => {
  const r = rig({ transcript: 'Thank you.', samples: tone(16000, 0.008), startState: 'listening' });
  assert.equal((await r.stt.processAudioFile(r.clip())).outcome, 'hallucination');
  assert.deepEqual(r.ev('USER_INPUT'), []);
  const loud = rig({ transcript: 'Thank you.', samples: tone(16000, 0.3), startState: 'listening' });
  await loud.stt.processAudioFile(loud.clip());
  assert.deepEqual(loud.ev('USER_INPUT'), ['thank you'], 'a real thank-you is passed on');
});
await test('a recogniser failure (timeout, dropped) is survived and the clip is cleaned up', async () => {
  const e = Object.assign(new Error('too slow'), { code: 'TIMEOUT' });
  const r = rig({ whisperError: e }); const f = r.clip();
  assert.match((await r.stt.processAudioFile(f)).outcome, /TIMEOUT/);
  assert.equal(fs.existsSync(f), false);
});
await test('not listening: the clip is discarded and nothing happens', async () => {
  const r = rig(); r.stt.isListening = false; const f = r.clip();
  assert.equal((await r.stt.processAudioFile(f)).outcome, 'not listening');
  assert.equal(fs.existsSync(f), false);
  assert.deepEqual(r.calls, []);
});
await test('an unreadable clip does not crash anything', async () => {
  const r = rig(); r.stt.readWav = async () => { throw new Error('corrupt wav'); }; const f = r.clip();
  assert.equal((await r.stt.processAudioFile(f)).outcome, 'error');
  assert.equal(fs.existsSync(f), false);
});
await test('the voice process only names a file: a path in it cannot escape the clip folder', async () => {
  const r = rig(); const seen = [];
  r.stt.processAudioFile = async (p) => { seen.push(p); return {}; };
  r.vad.emit('line', { type: 'audio', path: '..\\..\\Windows\\evil.wav' });
  r.vad.emit('line', { type: 'audio', path: '../../etc/passwd' });
  for (const p of seen) assert.equal(path.dirname(p), r.outDir);
});
await test('a microphone outage is announced once, and so is the recovery', () => {
  const r = rig();
  r.vad.emit('failed', { reason: 'no microphone found', code: 'no_microphone' });
  r.vad.emit('failed', { reason: 'no microphone found', code: 'no_microphone' });
  assert.equal(r.ev('RESPONSE_READY').length, 1);
  assert.match(r.ev('RESPONSE_READY')[0], /No microphone/);
  assert.equal(r.stt.health.mic, 'offline');
  r.vad.emit('ready', { restarts: 3 });
  assert.equal(r.ev('RESPONSE_READY').length, 2);
  assert.match(r.ev('RESPONSE_READY')[1], /hear again/);
  r.vad.emit('ready', { restarts: 4 });
  assert.equal(r.ev('RESPONSE_READY').length, 2, 'a normal restart is not announced');
});
await test('voice status text for the UI follows microphone and model health', () => {
  const r = rig();
  assert.match(r.stt.statusText(), /Starting voice/);
  r.vad.emit('ready', { restarts: 0 });
  assert.match(r.stt.statusText(), /Loading speech model/);
  r.w.emit('status', { model: 'ready', name: 'Xenova/whisper-base.en' });
  assert.equal(r.stt.statusText(), 'Listening (whisper-base.en)');
  r.vad.emit('restarting', { attempt: 1, delayMs: 1000, reason: 'x' });
  assert.match(r.stt.statusText(), /Reconnecting/);
  assert.equal(r.ev('VOICE_STATUS').length, 3, 'one status per change');
  assert.equal(r.ev('VOICE_STATUS').at(-1).text, r.stt.statusText());
});
// A tone written the way a recorder would: `amp` is the true loudness (0..1).
function toneWav({ rate = 16000, bits = '16', channels = 1, amp = 0.5, seconds = 1 } = {}) {
  const n = Math.round(rate * seconds);
  const max = { '8': 127, '16': 32767, '24': 8388607, '32': 2147483647 }[bits];
  const one = Array.from({ length: n }, (_, i) => {
    const v = amp * Math.sin(2 * Math.PI * 440 * i / rate);
    return bits === '32f' ? v : bits === '8' ? Math.round(128 + v * max) : Math.round(v * max);
  });
  const w = new wavefilePkg.WaveFile();
  w.fromScratch(channels, rate, bits, channels === 1 ? one : Array.from({ length: channels }, () => one));
  return Buffer.from(w.toBuffer());
}
const peakOf = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const midPeak = (s) => peakOf(s.subarray(800, s.length - 800));     // away from filter start-up at the edges

await test('WAV clips reach Whisper as -1..+1 at 16 kHz (they were 32,000x too loud: "buzzing")', () => {
  for (const bits of ['8', '16', '24', '32', '32f']) {
    const s = decodeWav(toneWav({ bits }));
    assert.ok(s instanceof Float32Array, bits);
    assert.equal(s.length, 16000, bits);
    assert.ok(Math.abs(peakOf(s) - 0.5) < 0.03, `${bits}-bit peak ${peakOf(s)}`);
  }
});
await test('other sample rates are converted to 16 kHz; stereo is mixed to mono; nothing exceeds 1', () => {
  for (const rate of [8000, 11025, 22050, 44100, 48000]) {
    const s = decodeWav(toneWav({ rate }));
    assert.ok(Math.abs(s.length - 16000) <= 2, `${rate}: ${s.length}`);
    assert.ok(Math.abs(midPeak(s) - 0.5) < 0.02, `${rate}: peak ${midPeak(s)}`);
  }
  assert.ok(Math.abs(peakOf(decodeWav(toneWav({ channels: 2 }))) - 0.5) < 0.03);
  assert.ok(peakOf(decodeWav(toneWav({ rate: 44100, amp: 1 }))) <= 1);
});
await test('with real levels the loudness gate works: normal speech passes, near-silence does not', () => {
  const gate = (amp) => shouldTranscribe(analyzeSamples(decodeWav(toneWav({ amp })), 16000), { minRms: 0.004, minSpeechMs: 350 });
  assert.equal(gate(0.05).ok, true, 'ordinary speech level');
  assert.equal(gate(0.01).ok, true, 'quiet speech');
  assert.equal(gate(0.002).ok, false, 'room noise');
  assert.match(gate(0.002).reason, /too quiet/);
});
await test('the app reads a real WAV clip at true loudness and passes it to Whisper that way', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-wav-'));
  const got = [];
  const vad = Object.assign(new EventEmitter(), { start() {}, stop() {} });
  const w = Object.assign(new EventEmitter(), { start() {}, stop() {}, async transcribe(s) { got.push(s); return { text: 'rocky what time is it', model: 'm' }; } });
  const stt = new SpeechToText({ config: { model: 'm', wakeWord: 'rocky', minSpeechMs: 350, minRms: 0.004, quietRms: 0.012 },
    eventBus: new EventEmitter(), stateManager: { getState: () => 'idle', setState() {} }, vad, whisper: w, outDir, log: () => {} });   // default WAV reader
  stt.isListening = true;
  const file = path.join(outDir, 'utt-real.wav');
  fs.writeFileSync(file, toneWav({ amp: 0.3, seconds: 1.5 }));
  const r = await stt.processAudioFile(file);
  assert.equal(r.outcome, 'wake');
  assert.equal(got.length, 1);
  assert.ok(Math.abs(peakOf(got[0]) - 0.3) < 0.02, `Whisper got peak ${peakOf(got[0])}, expected 0.3`);
  assert.equal(fs.existsSync(file), false, 'clip deleted afterwards');
});
await test('every clip the microphone sends says what happened to it (silence was invisible before)', () => {
  const r = rig(); const lines = [];
  r.stt.log = (m) => lines.push(m);
  r.stt._explain({ outcome: 'skipped: too quiet (rms 0.0021)' });
  r.stt._explain({ outcome: 'nothing heard' });
  r.stt._explain({ outcome: 'ignore', text: 'open notepad' });
  r.stt._explain({ outcome: 'not transcribed (TIMEOUT): slow' });
  r.stt._explain({ outcome: 'command', text: 'x' });
  assert.equal(lines.length, 4);
  assert.match(lines[0], /too quiet \(rms 0\.0021\) \(needs rms 0\.004/);
  assert.match(lines[2], /"open notepad" but no wake word \("rocky"\)/);
});
await test('which microphone is in use is shown, and following a changed default is announced once', () => {
  const r = rig();
  r.vad.emit('ready', { restarts: 0 });
  r.w.emit('status', { model: 'ready', name: 'Xenova/whisper-base.en' });
  r.vad.emit('device', { name: 'Laptop Array' });
  assert.equal(r.stt.statusText(), 'Listening (whisper-base.en) - Laptop Array');
  assert.equal(r.ev('RESPONSE_READY').length, 0, 'nothing said at start-up');
  r.vad.emit('device-changed', { name: 'Headset (USB)' });
  r.vad.emit('restarting', { attempt: 1, delayMs: 400, reason: 'default microphone changed' });
  r.vad.emit('ready', { restarts: 1 });
  r.vad.emit('device', { name: 'Headset (USB)' });
  assert.equal(r.stt.statusText(), 'Listening (whisper-base.en) - Headset (USB)');
  assert.deepEqual(r.ev('RESPONSE_READY'), ['Grace… Rocky hears through Headset (USB) now.']);
  r.vad.emit('device', { name: 'Headset (USB)' });
  assert.equal(r.ev('RESPONSE_READY').length, 1, 'only once per switch');
});
await test('start/stop drive both halves; starting twice does nothing', () => {
  const r = rig(); r.stt.isListening = false;
  r.stt.startListening(); r.stt.startListening();
  assert.ok(r.vad.started && r.w.started);
  r.stt.stopListening();
  assert.ok(r.vad.stopped && r.w.stopped);
  assert.equal(r.stt.isListening, false);
});
await test('leftover clips from a crash are removed on start, fresh ones are kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-clips-'));
  const old = path.join(dir, 'utt-1.wav'), fresh = path.join(dir, 'utt-2.wav'), other = path.join(dir, 'notes.txt');
  for (const f of [old, fresh, other]) fs.writeFileSync(f, 'x');
  fs.utimesSync(old, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  assert.equal(removeStaleClips(dir), 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['notes.txt', 'utt-2.wav']);
  assert.equal(removeStaleClips('/definitely/not/here'), 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
