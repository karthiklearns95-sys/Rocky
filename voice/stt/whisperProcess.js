import { EventEmitter } from 'events';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * Run the Whisper worker as a separate process instead of a thread.
 *
 * onnxruntime (under Whisper) prints ~150 "Removing initializer ... not used" warnings from native
 * code every time the model loads. No setting turns them off (logSeverityLevel and the graph
 * optimisation level were both tried against a model that triggers the same warning), and in a
 * thread they go straight into Rocky's terminal. A child process's output passes through here, so
 * those lines are dropped and everything else is kept.
 *
 * Returns an object shaped like a worker_threads Worker (postMessage, terminate, 'message' /
 * 'error' / 'exit' events), so WhisperClient does not care which one it gets.
 */

export const isOnnxNoise = (line) => /\[W:onnxruntime:/.test(line) || /^\s*$/.test(line);

export function createProcessWorker(workerData, { forkFn = fork, out = process.stdout, err = process.stderr } = {}) {
  const w = new EventEmitter();
  // Inside Electron, fork() runs Electron's own Node (ELECTRON_RUN_AS_NODE), so native modules match.
  const child = forkFn(fileURLToPath(new URL('./whisperWorker.js', import.meta.url)), [], {
    serialization: 'advanced',                 // Float32Array clips travel as they are
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ROCKY_WHISPER_DATA: JSON.stringify(workerData) },
    execArgv: [],
  });

  const relay = (stream, target) => {
    let rest = '';
    stream?.on('data', (d) => {
      const lines = (rest + d).split(/\r?\n/);
      rest = lines.pop();
      for (const l of lines) if (!isOnnxNoise(l)) target.write(`[Whisper] ${l}\n`);
    });
  };
  relay(child.stdout, out);
  relay(child.stderr, err);

  child.on('message', (m) => w.emit('message', m));
  child.on('error', (e) => w.emit('error', e));
  child.on('exit', (code) => w.emit('exit', code));
  w.postMessage = (m) => { if (child.connected) child.send(m); };
  w.terminate = () => { try { child.kill(); } catch { /* gone */ } };
  w.child = child;
  return w;
}
