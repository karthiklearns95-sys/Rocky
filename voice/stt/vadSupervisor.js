import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { killProcessTree } from '../../automation/system/execWithTimeout.js';
import { parseVadLine, LineBuffer } from './vadProtocol.js';

/**
 * VadSupervisor - keeps the native voice-activity process alive.
 *
 * That process (a PowerShell script using Windows speech recognition) holds the microphone. It can
 * die or go deaf: the Windows audio service restarts, the laptop sleeps and wakes with the old audio
 * handle dead, the script crashes. Before this, Rocky just stopped hearing until the app was
 * restarted. The supervisor:
 *
 *   - restarts it when it exits, with exponential back-off (1s, 2s, 4s ... 30s) so a persistent
 *     fault does not spin; the back-off resets once it has run stably for a while
 *   - watches for heartbeats; a process that is alive but silent (hung recogniser) is killed
 *   - notices the machine waking from sleep (the timer gap) and restarts it, because the audio
 *     device handle from before the sleep is stale
 *   - treats "no microphone" as a slow, patient retry (the headset may be plugged in later), and
 *     reports it once rather than every attempt
 *   - when Windows' default microphone changes (headset plugged in or out) the script says so and the
 *     supervisor restarts it on the new device straight away; that is not a failure and is not
 *     backed off (unless it happens over and over, which is treated as a fault)
 *   - after a run of fast failures, reports `failed` once and keeps retrying slowly; it never gives up
 *
 * Events: 'line' (parsed protocol message), 'ready', 'device' {name}, 'device-changed' {name},
 *         'restarting' {attempt, delayMs, reason},
 *         'failed' {reason, code}, 'stopped'
 *
 * Process spawning and all timers are injectable so the logic is testable without waiting.
 */
export class VadSupervisor extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.command executable
   * @param {string[]} opts.args
   */
  constructor({
    command, args = [],
    spawnFn = (cmd, a) => spawn(cmd, a, { windowsHide: true }),
    killFn = (child) => killProcessTree(child),
    now = Date.now,
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
    heartbeatTimeoutMs = 15000,
    readyTimeoutMs = 20000,
    backoff = { baseMs: 1000, maxMs: 30000, factor: 2 },
    stableAfterMs = 30000,
    maxRapidFailures = 6,
    noMicRetryMs = 8000,
    suspendGapMs = 10000,
    deviceSwitchDelayMs = 400,
    deviceFlapLimit = 5,
    deviceFlapWindowMs = 10000,
  } = {}) {
    super();
    Object.assign(this, { command, args, spawnFn, killFn, now, timers, heartbeatTimeoutMs, readyTimeoutMs, backoff, stableAfterMs, maxRapidFailures, noMicRetryMs, suspendGapMs, deviceSwitchDelayMs, deviceFlapLimit, deviceFlapWindowMs });

    this.wanted = false;
    this.child = null;
    this.failures = 0;          // consecutive fast failures
    this.reportedFailure = false;
    this.restartTimer = null;
    this.watchTimer = null;
    this.readyTimer = null;
    this.startedAt = 0;
    this.readyAt = 0;
    this.lastActivity = 0;
    this.lastTick = 0;
    this.lastErrorCode = null;
    this.stderrTail = '';
    this.restarts = 0;
    this.deviceName = '';        // the microphone it is listening to now
    this._deviceSwitch = false;  // the pending restart is a deliberate device switch
    this._switchTimes = [];
  }

  /** True while the process is running and has said [READY]. */
  get ready() { return Boolean(this.child && this.readyAt); }

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this._spawn();
  }

  stop() {
    this.wanted = false;
    this._clearTimers();
    this._kill();
    this.emit('stopped');
  }

  _spawn() {
    if (!this.wanted || this.child) return;
    this.lastErrorCode = null;
    this.stderrTail = '';
    const lines = new LineBuffer();
    let child;
    try {
      child = this.spawnFn(this.command, this.args);
    } catch (err) {
      this.child = null;
      return this._afterExit(null, null, `could not start: ${err.message}`);
    }
    this.child = child;
    this.startedAt = this.now();
    this.readyAt = 0;
    this.lastActivity = this.startedAt;
    this.lastTick = this.startedAt;

    child.stdout?.on('data', (d) => { for (const l of lines.push(d)) this._onLine(l); });
    child.stderr?.on('data', (d) => { this.stderrTail = (this.stderrTail + d).slice(-400); });
    child.on('error', (err) => this._onExit(child, null, null, `process error: ${err.message}`));
    child.on('exit', (code, signal) => this._onExit(child, code, signal));

    // It must say [READY] soon after starting (opening the microphone can hang).
    this.readyTimer = this.timers.setTimeout(() => {
      if (this.child === child && !this.readyAt) this._restartNow(`no [READY] within ${this.readyTimeoutMs} ms`);
    }, this.readyTimeoutMs);

    // One watchdog tick: heartbeat check + "did the machine just wake up?" check.
    if (!this.watchTimer) {
      const every = Math.max(250, Math.floor(this.heartbeatTimeoutMs / 3));
      this.watchTimer = this.timers.setInterval(() => this._watch(), every);
      this.watchTimer.unref?.();
    }
  }

  _onLine(line) {
    this.lastActivity = this.now();
    const msg = parseVadLine(line);
    if (msg.type === 'ready') {
      this.readyAt = this.now();
      this.timers.clearTimeout(this.readyTimer);
      this.emit('ready', { restarts: this.restarts });
    } else if (msg.type === 'device') {
      this.deviceName = msg.name;
      this.emit('device', { name: msg.name });
    } else if (msg.type === 'deviceChanged') {
      this.emit('device-changed', { name: msg.name });
      this._switchDevice(msg.name);
    } else if (msg.type === 'error') {
      this.lastErrorCode = msg.code;
    }
    this.emit('line', msg);
  }

  _watch() {
    if (!this.wanted || !this.child) return;
    const t = this.now();

    // Timers freeze while the machine sleeps, so a long gap between ticks means it just woke up.
    // The audio handle from before the sleep is dead even though the process looks fine.
    if (t - this.lastTick > this.suspendGapMs) {
      this.lastTick = t;
      return this._restartNow('machine resumed from sleep');
    }
    this.lastTick = t;

    if (this.readyAt && t - this.lastActivity > this.heartbeatTimeoutMs) {
      this._restartNow(`no heartbeat for ${Math.round((t - this.lastActivity) / 1000)}s`);
    }
  }

  /** The default microphone changed: restart on the new one now. A device that keeps flapping is a fault. */
  _switchDevice(name) {
    const t = this.now();
    this._switchTimes = this._switchTimes.filter((x) => t - x < this.deviceFlapWindowMs);
    this._switchTimes.push(t);
    this._deviceSwitch = this._switchTimes.length <= this.deviceFlapLimit;
    this.deviceName = '';
    this._restartNow(`default microphone changed${name ? ` to ${name}` : ''}`);
  }

  /** Kill the current process; its exit handler schedules the restart. */
  _restartNow(reason) {
    this._pendingReason = reason;
    if (this.child) this._kill();
  }

  _kill() {
    const child = this.child;
    if (!child) return;
    try { this.killFn(child); } catch { /* already gone */ }
  }

  _onExit(child, code, signal, extra) {
    if (this.child !== child) return;       // an old process we already replaced
    this.child = null;
    this.timers.clearTimeout(this.readyTimer);
    const why = this._pendingReason
      || extra
      || `exited (code ${code}${signal ? `, signal ${signal}` : ''})${this.stderrTail.trim() ? `: ${this.stderrTail.trim().slice(0, 160)}` : ''}`;
    this._pendingReason = null;
    this._afterExit(code, signal, why);
  }

  _afterExit(code, signal, why) {
    if (!this.wanted) return;

    const uptime = this.readyAt ? this.now() - this.readyAt : 0;
    const noMic = this.lastErrorCode === 'no_microphone';
    const deviceSwitch = this._deviceSwitch;
    this._deviceSwitch = false;

    if (uptime >= this.stableAfterMs) { this.failures = 0; this.reportedFailure = false; }
    else if (!noMic && !deviceSwitch) this.failures++;

    let delay;
    if (deviceSwitch) {
      delay = this.deviceSwitchDelayMs;     // nothing is broken: just listen to the new device
    } else if (noMic) {
      delay = this.noMicRetryMs;            // patient: someone may plug a headset in
    } else {
      delay = Math.min(this.backoff.maxMs, this.backoff.baseMs * this.backoff.factor ** Math.max(0, this.failures - 1));
      if (this.failures >= this.maxRapidFailures) delay = this.backoff.maxMs;
    }

    const stuck = !deviceSwitch && (noMic || this.failures >= this.maxRapidFailures);
    if (stuck && !this.reportedFailure) {
      this.reportedFailure = true;
      this.emit('failed', { reason: noMic ? 'no microphone found' : why, code: noMic ? 'no_microphone' : 'repeated_failure' });
    }

    this.restarts++;
    this.emit('restarting', { attempt: this.restarts, delayMs: delay, reason: why });
    this.restartTimer = this.timers.setTimeout(() => { this.restartTimer = null; this._spawn(); }, delay);
  }

  _clearTimers() {
    this.timers.clearTimeout(this.restartTimer);
    this.timers.clearTimeout(this.readyTimer);
    if (this.watchTimer) this.timers.clearInterval(this.watchTimer);
    this.restartTimer = this.readyTimer = this.watchTimer = null;
  }
}
