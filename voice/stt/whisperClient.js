import { EventEmitter } from 'events';
import { createProcessWorker } from './whisperProcess.js';

/**
 * WhisperClient - Rocky's side of the Whisper worker (a separate process, so recognition never
 * freezes the app and the speech engine's noisy output can be filtered).
 *
 * One clip is transcribed at a time. Clips that arrive while the model is still loading, or while
 * another clip is being recognised, wait in a small queue instead of being dropped:
 *   - at most `maxQueue` wait; beyond that the OLDEST is dropped (the newest is what Grace just said)
 *   - a clip that waited longer than `maxClipAgeMs` is discarded as stale (acting on a command from
 *     20 seconds ago would be worse than ignoring it)
 * A transcription that takes longer than `requestTimeoutMs` kills the worker and starts a new one.
 * A crashed worker is restarted with back-off. Rejections carry a `code`:
 *   DROPPED | STALE | TIMEOUT | WORKER | NO_MODEL | STOPPED
 *
 * Events: 'status' { model: 'loading'|'ready'|'failed', name?, detail? }
 */
const fail = (code, message) => Object.assign(new Error(message), { code });

export class WhisperClient extends EventEmitter {
  constructor({
    models,
    cacheDir = null,
    loaderModule = undefined,   // test hook: module that exports { pipeline, env } instead of @xenova/transformers
    createWorker = (workerData) => createProcessWorker(workerData),   // a separate process (see whisperProcess.js)
    maxQueue = 4,
    maxClipAgeMs = 20000,
    requestTimeoutMs = 45000,
    loadTimeoutMs = 10 * 60 * 1000,
    restartBackoff = { baseMs: 1000, maxMs: 30000 },
    loadRetryBackoff = { baseMs: 30000, maxMs: 10 * 60 * 1000 },   // no model could load (offline?): try rarely
    now = Date.now,
    timers = { setTimeout, clearTimeout },
  }) {
    super();
    Object.assign(this, { models, cacheDir, loaderModule, createWorker, maxQueue, maxClipAgeMs, requestTimeoutMs, loadTimeoutMs, restartBackoff, loadRetryBackoff, now, timers });

    this.worker = null;
    this.ready = false;
    this.modelName = null;
    this.queue = [];            // { samples, resolve, reject, enqueuedAt }
    this.inFlight = null;       // { id, req, timer }
    this.nextId = 1;
    this.restartTimer = null;
    this.loadTimer = null;
    this.crashes = 0;
    this.stopped = false;
  }

  /** Start the worker (and with it the model load) in the background. */
  start() {
    this.stopped = false;
    if (!this.worker) this._spawn();
  }

  stop() {
    this.stopped = true;
    this.timers.clearTimeout(this.restartTimer);
    this._teardown(fail('STOPPED', 'speech recogniser stopped'));
  }

  _status(model, detail) { this.emit('status', { model, name: this.modelName, detail }); }

  _spawn() {
    if (this.stopped || this.worker) return;
    this._status('loading');
    let worker;
    try {
      worker = this.createWorker({ models: this.models, cacheDir: this.cacheDir, loaderModule: this.loaderModule });
    } catch (err) {
      return this._crashed(null, `could not start the recogniser: ${err.message}`);
    }
    this.worker = worker;
    this.ready = false;

    this.loadTimer = this.timers.setTimeout(() => {
      if (this.worker === worker && !this.ready) this._crashed(worker, `model did not load within ${Math.round(this.loadTimeoutMs / 1000)}s`, true);
    }, this.loadTimeoutMs);

    worker.on('message', (msg) => this._onMessage(worker, msg));
    worker.on('error', (err) => this._crashed(worker, err.message));
    worker.on('exit', (code) => this._crashed(worker, `worker exited (code ${code})`));
  }

  _onMessage(worker, msg) {
    if (this.worker !== worker || !msg) return;
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.modelName = msg.model;
        this.crashes = 0;
        this.timers.clearTimeout(this.loadTimer);
        this._status('ready');
        this._pump();
        break;
      case 'load_failed':
        // No model could be loaded at all: tell everyone waiting, retry later (maybe the network is back).
        this.timers.clearTimeout(this.loadTimer);
        this._status('failed', msg.error);
        this._rejectQueued(fail('NO_MODEL', msg.error));
        this._crashed(worker, msg.error, true, true);
        break;
      case 'result':
      case 'error': {
        if (!this.inFlight || this.inFlight.id !== msg.id) return;
        const { req, timer } = this.inFlight;
        this.timers.clearTimeout(timer);
        this.inFlight = null;
        if (msg.type === 'result') req.resolve({ text: msg.text, model: msg.model });
        else req.reject(fail('WORKER', msg.error));
        this._pump();
        break;
      }
      default: break;   // 'log'
    }
  }

  /** Transcribe 16 kHz mono samples. Resolves { text, model }. */
  transcribe(samples) {
    if (this.stopped) return Promise.reject(fail('STOPPED', 'speech recogniser stopped'));
    return new Promise((resolve, reject) => {
      this.queue.push({ samples, resolve, reject, enqueuedAt: this.now() });
      while (this.queue.length > this.maxQueue) {
        this.queue.shift().reject(fail('DROPPED', 'too many clips waiting; dropped the oldest'));
      }
      this._pump();
    });
  }

  _pump() {
    if (!this.ready || this.inFlight || !this.worker) return;
    while (this.queue.length) {
      const req = this.queue.shift();
      if (this.now() - req.enqueuedAt > this.maxClipAgeMs) { req.reject(fail('STALE', 'clip waited too long')); continue; }
      const id = this.nextId++;
      const timer = this.timers.setTimeout(() => this._timedOut(id), this.requestTimeoutMs);
      this.inFlight = { id, req, timer };
      this.worker.postMessage({ type: 'transcribe', id, samples: req.samples });
      return;
    }
  }

  _timedOut(id) {
    if (!this.inFlight || this.inFlight.id !== id) return;
    const { req } = this.inFlight;
    this.inFlight = null;
    req.reject(fail('TIMEOUT', `transcription took longer than ${Math.round(this.requestTimeoutMs / 1000)}s`));
    this._crashed(this.worker, 'transcription timed out', true);
  }

  _rejectQueued(err) {
    const q = this.queue; this.queue = [];
    for (const r of q) r.reject(err);
  }

  /** Drop the worker, fail what was in flight, and start a replacement after a pause. */
  _crashed(worker, reason, kill = false, loadFailure = false) {
    if (worker && this.worker !== worker) return;            // an old worker we already replaced
    const old = this.worker;
    this._teardown(fail('WORKER', reason), false);
    if (old && kill) { try { old.terminate(); } catch { /* gone */ } }
    if (this.stopped) return;

    this.crashes++;
    const b = loadFailure ? this.loadRetryBackoff : this.restartBackoff;
    const delay = Math.min(b.maxMs, b.baseMs * 2 ** (this.crashes - 1));
    this._status(loadFailure ? 'failed' : 'loading', `restarting the recogniser in ${Math.round(delay / 1000)}s: ${reason}`);
    this.restartTimer = this.timers.setTimeout(() => { this.restartTimer = null; this._spawn(); }, delay);
  }

  _teardown(err, rejectQueue = true) {
    this.timers.clearTimeout(this.loadTimer);
    if (this.inFlight) { this.timers.clearTimeout(this.inFlight.timer); this.inFlight.req.reject(err); this.inFlight = null; }
    if (rejectQueue) this._rejectQueued(err);
    const w = this.worker;
    this.worker = null;
    this.ready = false;
    if (w && rejectQueue) { try { w.terminate(); } catch { /* gone */ } }
  }
}
