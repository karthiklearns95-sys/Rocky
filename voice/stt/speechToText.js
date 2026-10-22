import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import eventBus from '#services/eventBus.js';
import stateManager from '#services/stateManager.js';
import config from '../../config/app.config.js';
import { VadSupervisor } from './vadSupervisor.js';
import { WhisperClient } from './whisperClient.js';
import { decodeWav } from './wavReader.js';
import { analyzeSamples, shouldTranscribe, isHallucination } from './audioGate.js';
import { interpretTranscript, cleanTranscript } from './transcript.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PS_SCRIPT = path.join(__dirname, 'windowsSpeech.ps1');

/** Read a WAV file as 16 kHz mono Float32 samples in -1..+1 (what Whisper expects). See wavReader.js. */
async function readWavSamples(file) {
  return decodeWav(fs.readFileSync(file));
}

/** Remove clips left behind by an earlier crash. */
export function removeStaleClips(dir, maxAgeMs = 10 * 60 * 1000, { fsApi = fs, now = Date.now } = {}) {
  let removed = 0;
  try {
    for (const name of fsApi.readdirSync(dir)) {
      if (!/^utt-.*\.wav$/.test(name)) continue;
      const file = path.join(dir, name);
      try {
        if (now() - fsApi.statSync(file).mtimeMs > maxAgeMs) { fsApi.unlinkSync(file); removed++; }
      } catch { /* in use or gone */ }
    }
  } catch { /* folder does not exist yet */ }
  return removed;
}

/**
 * SpeechToText - Rocky's ears.
 *
 *   microphone -> windowsSpeech.ps1 (voice activity + one WAV per utterance)   [VadSupervisor keeps it alive]
 *     -> audio gate (too short / too quiet clips are not sent)
 *     -> Whisper in a worker thread                                            [WhisperClient]
 *     -> hallucination filter -> wake word / stop word / command               [transcript.js]
 *     -> eventBus (USER_INPUT, ABORT_EXECUTION) and the state manager
 *
 * Voice health is published as 'VOICE_STATUS' so the UI can show it, and Rocky says so (once) when he
 * cannot hear, and when he can again.
 */
export default class SpeechToText {
  constructor(deps = {}) {
    const stt = deps.config || config.stt;
    this.cfg = stt;
    this.bus = deps.eventBus || eventBus;
    this.state = deps.stateManager || stateManager;
    this.outDir = deps.outDir || path.join(os.tmpdir(), 'rocky_voice');
    this.readWav = deps.readWav || readWavSamples;
    this.fsApi = deps.fsApi || fs;
    this.log = deps.log || ((m) => console.log(`[STT] ${m}`));

    const models = [stt.model, ...(stt.fallbackModels || [])].filter((m, i, a) => m && a.indexOf(m) === i);
    this.whisper = deps.whisper || new WhisperClient({
      models,
      cacheDir: stt.cacheDir || path.join(os.homedir(), '.rocky', 'models'),
      maxQueue: stt.maxQueue, maxClipAgeMs: stt.maxClipAgeMs, requestTimeoutMs: stt.requestTimeoutMs,
    });
    this.vad = deps.vad || new VadSupervisor({
      // Starting PowerShell and the speech engine took over 20 s while the AI models were loading.
      readyTimeoutMs: stt.vadReadyTimeoutMs || 45000,
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT, '-OutDir', this.outDir],
    });

    this.isListening = false;
    this.health = { mic: 'starting', model: 'loading', modelName: null, detail: '', device: '' };
    this.deviceSwitched = false;     // a default-microphone change is being followed
    this.announcedMicFailure = false;
    this.now = deps.now || Date.now;
    this.speechWindows = [];          // when Rocky was talking: [{ start, end }]
    this._wire();
  }

  _wire() {
    this.whisper.on('status', (s) => {
      this.health.model = s.model;
      if (s.name) this.health.modelName = s.name;
      this.health.detail = s.detail || '';
      if (s.model === 'ready') this.log(`Whisper (${s.name}) ready.`);
      else if (s.detail) this.log(`Whisper ${s.model}: ${s.detail}`);
      this._publish();
    });

    this.vad.on('line', (msg) => this._onVadMessage(msg));
    this.vad.on('device', ({ name }) => {
      this.health.device = name;
      if (name) this.log(`Listening to microphone: ${name}`);
      this._publish();
      // Said once, and only for a switch Rocky followed while running (not at start-up).
      if (this.deviceSwitched) {
        this.deviceSwitched = false;
        this.bus.emit('RESPONSE_READY', name ? `Grace… Rocky hears through ${name} now.` : 'Grace… Rocky hears through your new microphone now.');
      }
    });
    this.vad.on('device-changed', ({ name }) => {
      this.deviceSwitched = true;
      this.health.device = '';
      this.log(`Default microphone changed${name ? ` to ${name}` : ''}; following it.`);
    });
    this.vad.on('ready', ({ restarts }) => {
      this.health.mic = 'ready';
      this.log(restarts ? `Microphone is back (restart ${restarts}). Say "Rocky".` : 'Native VAD ready. Say "Rocky".');
      this._publish();
      if (this.announcedMicFailure) {
        this.announcedMicFailure = false;
        this.bus.emit('RESPONSE_READY', 'Grace… Rocky can hear again. Amaze.');
      }
    });
    this.vad.on('restarting', ({ attempt, delayMs, reason }) => {
      this.health.mic = 'restarting';
      this.log(`Microphone process restarting (#${attempt}) in ${Math.round(delayMs / 1000)}s: ${reason}`);
      this._publish();
    });
    this.vad.on('failed', ({ reason, code }) => {
      this.health.mic = 'offline';
      this.health.detail = reason;
      this.log(`Cannot hear: ${reason}`);
      this._publish();
      if (!this.announcedMicFailure) {
        this.announcedMicFailure = true;
        this.bus.emit('RESPONSE_READY', code === 'no_microphone'
          ? 'Grace… Rocky cannot hear. No microphone found. Plug one in. Rocky keeps trying.'
          : 'Grace… Rocky cannot hear right now. Rocky keeps trying.');
      }
    });
  }

  /** What the UI shows next to Rocky. */
  statusText() {
    const { mic, model, modelName, device } = this.health;
    if (mic === 'offline') return 'Microphone offline: retrying';
    if (mic === 'restarting') return 'Reconnecting microphone...';
    if (model === 'failed') return 'Speech model unavailable (retrying)';
    if (model === 'loading') return mic === 'ready' ? 'Loading speech model...' : 'Starting voice...';
    return `Listening (${(modelName || '').replace(/^Xenova\//, '') || 'whisper'})${device ? ` - ${device}` : ''}`;
  }

  _publish() {
    this.bus.emit('VOICE_STATUS', { ...this.health, text: this.statusText() });
  }

  _onVadMessage(msg) {
    switch (msg.type) {
      case 'wake':
        this.log('Wake word detected by VAD!');
        this.state.setState('listening');
        break;
      case 'stop':
        this.log('🛑 Native VAD triggered STOP!');
        this.bus.emit('ABORT_EXECUTION');
        this.state.setState('idle');
        break;
      case 'audio':
        // A bare file name from our own script; never trust it as a path.
        this.processAudioFile(path.join(this.outDir, path.basename(msg.path))).then((r) => this._explain(r));
        break;
      case 'error':
        this.log(`VAD error: ${msg.code} ${msg.message}`);
        break;
      default: break;
    }
  }

  /**
   * Rocky started (true) or stopped (false) talking. Clips recorded while he talked are his own
   * voice coming back through the microphone ("got it i'm on it"), so they are dropped.
   */
  rockySpeaking(on) {
    // Counted, so two replies that overlap still close the window exactly once (an open window would
    // make Rocky ignore Grace for good).
    const t = this.now();
    if (on) {
      if ((this.speaking = (this.speaking || 0) + 1) === 1) this.speechWindows.push({ start: t, end: Infinity });
    } else if (this.speaking > 0 && --this.speaking === 0) {
      const w = this.speechWindows[this.speechWindows.length - 1];
      if (w && w.end === Infinity) w.end = t;
    }
    if (this.speechWindows.length > 5) this.speechWindows.shift();
  }

  /**
   * Did this clip overlap Rocky's own speech? The voice process hands a clip over about half a second
   * after the sound stops (its end-of-speech wait), so the clip covered roughly
   * [arrival - 500 ms - duration, arrival - 500 ms]. The room echoes a little after he stops: 400 ms tail.
   */
  _isEcho(durationMs, arrivedAt = this.now()) {
    const end = arrivedAt - 500, start = end - durationMs;
    return this.speechWindows.some((w) => start < w.end + 400 && end > w.start);
  }

  /**
   * Say in the log what happened to a clip the microphone caught. Without this, a clip that was too
   * quiet, had no words, or had no wake word simply vanished, and "Rocky can't hear me" could not be
   * told apart from "the microphone sends nothing".
   */
  _explain(r) {
    const o = r?.outcome || '';
    if (o.startsWith('skipped')) this.log(`Heard a sound, skipped it: ${o.replace('skipped: ', '')} (needs rms ${this.cfg.minRms ?? 0.004}, ${this.cfg.minSpeechMs ?? 350} ms)`);
    else if (o === 'nothing heard') this.log('Heard a sound, but no words in it.');
    else if (o === 'ignore') this.log(`Heard "${r.text}" but no wake word ("${this.cfg.wakeWord || 'rocky'}"): ignored.`);
    else if (o.startsWith('not transcribed')) this.log(`A clip was not transcribed: ${o.replace('not transcribed ', '')}`);
    else if (o === 'echo') this.log('Ignored a clip recorded while Rocky was talking (his own voice).');
  }

  /**
   * One utterance: check it, transcribe it, and act on it. Always deletes the clip. Never throws.
   * @returns {Promise<{outcome: string, text?: string}>} what happened (for tests and logs)
   */
  async processAudioFile(wavPath) {
    try {
      if (!this.isListening) return { outcome: 'not listening' };
      if (!this.fsApi.existsSync(wavPath)) return { outcome: 'missing file' };

      const arrivedAt = this.now();
      const samples = await this.readWav(wavPath);
      const stats = analyzeSamples(samples, 16000);
      if (this._isEcho(stats.durationMs, arrivedAt)) return { outcome: 'echo' };
      const gate = shouldTranscribe(stats, this.cfg);
      if (!gate.ok) return { outcome: `skipped: ${gate.reason}` };

      let heard;
      try {
        heard = await this.whisper.transcribe(samples);
      } catch (err) {
        // DROPPED / STALE / STOPPED are normal under load; WORKER / TIMEOUT / NO_MODEL are logged by status.
        return { outcome: `not transcribed (${err.code || 'error'}): ${err.message}` };
      }

      const text = cleanTranscript(heard.text);
      if (!text) return { outcome: 'nothing heard' };
      if (isHallucination(text, stats, this.cfg)) {
        this.log(`ignored Whisper filler: "${text}"`);
        return { outcome: 'hallucination', text };
      }
      this.log(`Whisper recognized: "${text}"`);

      const decision = interpretTranscript(text, { listening: this.state.getState() === 'listening', wakeWord: this.cfg.wakeWord });
      switch (decision.kind) {
        case 'interrupt':
          this.log(`🛑 Contextual Interrupt triggered by: "${text}"`);
          this.bus.emit('ABORT_EXECUTION');
          this.state.setState('idle');
          break;
        case 'wake':
          this.state.setState('listening');
          if (decision.command) this.bus.emit('USER_INPUT', decision.command);
          break;
        case 'command':
          this.bus.emit('USER_INPUT', decision.text);
          this.state.setState('idle');
          break;
        default: break;
      }
      return { outcome: decision.kind, text };
    } catch (err) {
      this.log(`Inference error: ${err.message}`);
      return { outcome: 'error' };
    } finally {
      this._keepClip(wavPath);
      try { if (this.fsApi.existsSync(wavPath)) this.fsApi.unlinkSync(wavPath); } catch { /* already gone */ }
    }
  }

  /**
   * ROCKY_KEEP_CLIPS=1: keep the last few clips in <outDir>/kept so you can play back exactly what
   * Rocky heard (the only way to tell a bad microphone from a bad recogniser).
   */
  _keepClip(wavPath, keep = 10) {
    if (process.env.ROCKY_KEEP_CLIPS !== '1') return;
    try {
      const dir = path.join(this.outDir, 'kept');
      this.fsApi.mkdirSync(dir, { recursive: true });
      this.fsApi.copyFileSync(wavPath, path.join(dir, path.basename(wavPath)));
      const old = this.fsApi.readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
      for (const f of old.slice(0, Math.max(0, old.length - keep))) this.fsApi.unlinkSync(path.join(dir, f));
      if (!this._toldKeep) { this._toldKeep = true; this.log(`Keeping the last ${keep} clips in ${dir} (ROCKY_KEEP_CLIPS=1).`); }
    } catch { /* diagnostics only */ }
  }

  startListening() {
    if (this.isListening) return;
    this.isListening = true;
    this.log('Starting offline Native VAD engine...');
    removeStaleClips(this.outDir, undefined, { fsApi: this.fsApi });
    this.whisper.start();
    this.vad.start();
    this._publish();
  }

  stopListening() {
    this.isListening = false;
    this.vad.stop();
    this.whisper.stop();
    this.log('Engine stopped.');
  }
}
