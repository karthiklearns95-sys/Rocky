// Worker-thread entry: runs Whisper off the main thread so a transcription (hundreds of ms of
// solid CPU work) never freezes the app's event loop, UI messages or wake-word handling.
//
// Protocol (messages to/from the parent):
//   parent -> { type: 'transcribe', id, samples: Float32Array }
//   worker -> { type: 'ready', model } | { type: 'load_failed', error }
//          -> { type: 'result', id, text, model } | { type: 'error', id, error }
import path from 'path';
import { pathToFileURL } from 'url';
import { parentPort, workerData } from 'worker_threads';
import { createTranscriber } from './transcriberCore.js';

const { models, cacheDir, loaderModule = '@xenova/transformers' } = workerData;

/**
 * Loading Whisper makes onnxruntime print ~150 harmless "Removing initializer ... not used" warnings,
 * which buried Rocky's own log. transformers.js gives no way to pass session options, so add
 * logSeverityLevel 3 (errors only) to every session it creates.
 */
async function quietOnnx() {
  try {
    const ort = await import('onnxruntime-node');
    const IS = ort.InferenceSession ?? ort.default?.InferenceSession;
    if (!IS || IS.rockyQuiet) return;
    const create = IS.create.bind(IS);
    IS.create = (model, options, ...rest) => (options && typeof options === 'object' && !ArrayBuffer.isView(options) && !rest.length
      ? create(model, { logSeverityLevel: 3, ...options })
      : create(model, options, ...rest));
    IS.rockyQuiet = true;
  } catch { /* only cosmetic */ }
}

const transcriber = createTranscriber({
  models,
  log: (m) => parentPort.postMessage({ type: 'log', message: m }),
  loadPipeline: async (model) => {
    // '@xenova/transformers' unless a test swaps in a file. A file path must be a file:// URL: on
    // Windows import('F:\\x.mjs') fails because "f:" looks like a URL scheme.
    const spec = path.isAbsolute(loaderModule) ? pathToFileURL(loaderModule).href : loaderModule;
    const { pipeline, env } = await import(spec);
    if (loaderModule === '@xenova/transformers') await quietOnnx();
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
