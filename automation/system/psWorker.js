import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { killProcessTree } from './execWithTimeout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = '@@ROCKY@@';
const SCRIPT_PATH = path.join(__dirname, 'rockyWorker.ps1');

/**
 * PsWorker - one long-lived PowerShell process that answers requests.
 *
 * Starting powershell.exe and loading UI Automation / OCR / C# helpers costs
 * seconds. Doing it once and keeping the process alive turns every later
 * lookup into milliseconds. See rockyWorker.ps1 for the protocol.
 *
 * Design rules:
 *   - It only ever makes things faster. If the worker cannot start, times out
 *     or crashes, callers get a clear error (or use tryWorker) and fall back to
 *     the old one-shot scripts; nothing depends on the worker being there.
 *   - One request at a time (UI Automation is not happy with overlapping calls).
 *   - A request that times out kills the worker; the next request starts a fresh
 *     one (a hung COM call cannot be cancelled any other way).
 *   - Circuit breaker: after repeated start-up failures the worker is skipped
 *     for a while, so a broken setup does not add a failed spawn to every call.
 *   - Request data travels as JSON on stdin and is never run as script.
 */
export class PsWorker {
  /**
   * @param {object} [opts]
   * @param {string} [opts.command] executable (default powershell.exe on Windows)
   * @param {string[]} [opts.args] its arguments (default runs rockyWorker.ps1)
   * @param {boolean} [opts.enabled] force on/off (default: Windows and ROCKY_PS_WORKER != 0)
   */
  constructor(opts = {}) {
    this.command = opts.command || 'powershell.exe';
    this.args = opts.args || ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH];
    this.enabled = opts.enabled ?? (process.platform === 'win32' && process.env.ROCKY_PS_WORKER !== '0');
    this.startupTimeoutMs = opts.startupTimeoutMs ?? 20000;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 8000;
    this.maxStartFailures = opts.maxStartFailures ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 5 * 60 * 1000;
    this.now = opts.now || Date.now;

    this.child = null;
    this.ready = null;          // promise that resolves when the worker says ready
    this.pending = new Map();   // id -> { resolve, reject, timer }
    this.nextId = 1;
    this.buffer = '';
    this.stderrTail = '';
    this.startFailures = 0;
    this.disabledUntil = 0;
    this.queue = Promise.resolve();
    this.lastError = null;
  }

  /** True when a request is worth attempting (enabled and not cooling down). */
  isAvailable() {
    return this.enabled && this.now() >= this.disabledUntil;
  }

  _start() {
    if (this.ready) return this.ready;

    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };

      const child = spawn(this.command, this.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      this.buffer = '';
      this.stderrTail = '';

      const timer = setTimeout(() => {
        fail(new Error(`worker did not become ready within ${this.startupTimeoutMs}ms`));
        this._kill();
      }, this.startupTimeoutMs);

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        this.buffer += chunk;
        let nl;
        while ((nl = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, nl).replace(/\r$/, '');
          this.buffer = this.buffer.slice(nl + 1);
          if (!line.startsWith(PREFIX)) continue; // stray output: ignore
          let msg;
          try { msg = JSON.parse(line.slice(PREFIX.length)); } catch { continue; }
          if (msg.ready) {
            if (!settled) { settled = true; clearTimeout(timer); this.startFailures = 0; resolve(); }
            continue;
          }
          const p = this.pending.get(msg.id);
          if (!p) continue;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new Error(msg.error || 'worker error'));
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => { this.stderrTail = (this.stderrTail + d).slice(-500); });
      // Writing to a dead worker raises EPIPE on stdin; the exit handler reports it.
      child.stdin.on('error', () => {});

      child.on('error', (err) => {
        fail(err);
        this._onExit(child, `failed to start: ${err.message}`);
      });
      child.on('exit', (code, signal) => {
        const why = `exited (code ${code}${signal ? `, signal ${signal}` : ''})${this.stderrTail ? `: ${this.stderrTail.trim()}` : ''}`;
        fail(new Error(`worker ${why}`));
        this._onExit(child, why);
      });
    });

    // A start-up failure is counted once, and may trip the circuit breaker.
    const thisStart = this.ready;
    thisStart.catch((err) => {
      this.lastError = err;
      this.startFailures++;
      if (this.ready === thisStart) this.ready = null;
      if (this.startFailures >= this.maxStartFailures) {
        this.disabledUntil = this.now() + this.cooldownMs;
        this.startFailures = 0;
        console.warn(`[PsWorker] Giving up for ${Math.round(this.cooldownMs / 1000)}s after repeated start-up failures (${err.message}). Falling back to one-shot scripts.`);
      }
    });
    return this.ready;
  }

  _onExit(child, why) {
    if (this.child !== child) return; // an old worker we already replaced
    this.child = null;
    this.ready = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`worker ${why}`));
      this.pending.delete(id);
    }
  }

  _kill() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.ready = null;
    try { child.stdin.end(); } catch { /* already closed */ }
    killProcessTree(child);
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('worker was stopped'));
      this.pending.delete(id);
    }
  }

  /**
   * Send one request and wait for the answer. Requests run one at a time, in order.
   * Rejects on worker error, timeout, crash or when unavailable.
   */
  request(cmd, args = {}, { timeoutMs } = {}) {
    if (!this.isAvailable()) return Promise.reject(new Error('worker unavailable'));
    const run = () => this._send(cmd, args, timeoutMs ?? this.defaultTimeoutMs);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async _send(cmd, args, timeoutMs) {
    await this._start();
    const child = this.child;
    if (!child) throw new Error('worker is not running');
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`worker request "${cmd}" timed out after ${timeoutMs}ms`));
        this._kill(); // a hung call cannot be cancelled; the next request starts a fresh worker
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /** Stop the worker (it is restarted by the next request). */
  dispose() {
    this._kill();
  }
}

export const psWorker = new PsWorker();
process.on('exit', () => psWorker.dispose());

let warned = false;
/**
 * Never throws: { ok: true, result } or { ok: false, reason }.
 * Callers use the reason only for logging, then fall back to the old script.
 */
export async function tryWorker(cmd, args = {}, opts = {}, worker = psWorker) {
  if (!worker.isAvailable()) return { ok: false, reason: 'worker unavailable' };
  try {
    return { ok: true, result: await worker.request(cmd, args, opts) };
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(`[PsWorker] "${cmd}" failed (${err.message}); using the slower one-shot script. Further worker problems are logged at debug level only.`);
    } else {
      console.debug(`[PsWorker] "${cmd}" failed (${err.message}); falling back.`);
    }
    return { ok: false, reason: err.message };
  }
}
