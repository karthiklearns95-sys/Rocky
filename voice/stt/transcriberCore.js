/**
 * transcriberCore - loads a Whisper model (falling back to smaller ones) and transcribes samples.
 * No threads and no model library imported here: the pipeline loader is injected, so this runs
 * inside the worker thread in the app and with a fake pipeline in tests.
 */

/** Decoding options. English-only models (".en") reject language/task options. */
export function optionsFor(model) {
  const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false };
  if (!/\.en$/i.test(String(model))) { opts.language = 'english'; opts.task = 'transcribe'; }
  return opts;
}

/**
 * @param {object} deps
 * @param {string[]} deps.models preferred model first, then fallbacks
 * @param {(model: string) => Promise<Function>} deps.loadPipeline returns a function (samples, opts) => {text}
 * @param {(msg: string) => void} [deps.log]
 */
export function createTranscriber({ models, loadPipeline, log = () => {} }) {
  let pipe = null;
  let loadedModel = null;
  let loading = null;

  async function ensureLoaded() {
    if (pipe) return loadedModel;
    if (!loading) {
      loading = (async () => {
        let lastError = null;
        for (const model of models) {
          try {
            log(`loading ${model}`);
            pipe = await loadPipeline(model);
            loadedModel = model;
            return loadedModel;
          } catch (err) {
            lastError = err;
            log(`could not load ${model}: ${err.message}`);
          }
        }
        throw new Error(`no speech model could be loaded (${lastError ? lastError.message : 'none configured'})`);
      })().finally(() => { if (!pipe) loading = null; });   // a failed load can be retried
    }
    return loading;
  }

  async function transcribe(samples) {
    const model = await ensureLoaded();
    const out = await pipe(samples, optionsFor(model));
    return { text: String(out?.text ?? '').trim(), model };
  }

  return { ensureLoaded, transcribe, get model() { return loadedModel; } };
}
