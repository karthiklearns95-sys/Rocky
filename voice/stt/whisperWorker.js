// Whisper worker: runs Whisper off the main thread so a transcription (hundreds of ms of solid CPU
// work) never freezes the app's event loop, UI messages or wake-word handling. It normally runs as a
// child process (whisperProcess.js); it also still works as a worker thread.
//
// Protocol (messages to/from the parent):
//   parent -> { type: 'transcribe', id, samples: Float32Array }
//   worker -> { type: 'ready', model } | { type: 'load_failed', error }
//          -> { type: 'result', id, text, model } | { type: 'error', id, error }
import path from 'path';
import { pathToFileURL } from 'url';
import { parentPort, workerData } from 'worker_threads';
import { createTranscriber } from './transcriberCore.js';

// As a child process: the parent's settings come in the environment, messages over the IPC channel.
const port = parentPort || { postMessage: (m) => process.send?.(m), on: (ev, fn) => process.on(ev, fn) };
const data = workerData || JSON.parse(process.env.ROCKY_WHISPER_DATA || '{}');
if (!parentPort) process.on('disconnect', () => process.exit(0));   // Rocky went away: so do we
const { models, cacheDir, loaderModule = '@xenova/transformers' } = data;

const transcriber = createTranscriber({
  models,
  log: (m) => port.postMessage({ type: 'log', message: m }),
  loadPipeline: async (model) => {
    // '@xenova/transformers' unless a test swaps in a file. A file path must be a file:// URL: on
    // Windows import('F:\\x.mjs') fails because "f:" looks like a URL scheme.
    const spec = path.isAbsolute(loaderModule) ? pathToFileURL(loaderModule).href : loaderModule;
    const { pipeline, env } = await import(spec);
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    if (cacheDir) env.cacheDir = cacheDir;          // keep downloaded models outside node_modules
    return pipeline('automatic-speech-recognition', model);
  },
});

// Start loading straight away so the first command is not slowed by the model load.
transcriber.ensureLoaded()
  .then((model) => port.postMessage({ type: 'ready', model }))
  .catch((err) => port.postMessage({ type: 'load_failed', error: err.message }));

port.on('message', async (msg) => {
  if (msg?.type !== 'transcribe') return;
  try {
    const { text, model } = await transcriber.transcribe(msg.samples);
    port.postMessage({ type: 'result', id: msg.id, text, model });
  } catch (err) {
    port.postMessage({ type: 'error', id: msg.id, error: err.message });
  }
});
