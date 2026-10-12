// Worker-thread entry: runs Whisper off the main thread so a transcription (hundreds of ms of
// solid CPU work) never freezes the app's event loop, UI messages or wake-word handling.
//
// Protocol (messages to/from the parent):
//   parent -> { type: 'transcribe', id, samples: Float32Array }
//   worker -> { type: 'ready', model } | { type: 'load_failed', error }
//          -> { type: 'result', id, text, model } | { type: 'error', id, error }
import { parentPort, workerData } from 'worker_threads';
import { createTranscriber } from './transcriberCore.js';

const { models, cacheDir, loaderModule = '@xenova/transformers' } = workerData;

const transcriber = createTranscriber({
  models,
  log: (m) => parentPort.postMessage({ type: 'log', message: m }),
  loadPipeline: async (model) => {
    const { pipeline, env } = await import(loaderModule);   // '@xenova/transformers' unless a test swaps it
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    if (cacheDir) env.cacheDir = cacheDir;          // keep downloaded models outside node_modules
    return pipeline('automatic-speech-recognition', model);
  },
});

// Start loading straight away so the first command is not slowed by the model load.
transcriber.ensureLoaded()
  .then((model) => parentPort.postMessage({ type: 'ready', model }))
  .catch((err) => parentPort.postMessage({ type: 'load_failed', error: err.message }));

parentPort.on('message', async (msg) => {
  if (msg?.type !== 'transcribe') return;
  try {
    const { text, model } = await transcriber.transcribe(msg.samples);
    parentPort.postMessage({ type: 'result', id: msg.id, text, model });
  } catch (err) {
    parentPort.postMessage({ type: 'error', id: msg.id, error: err.message });
  }
});
