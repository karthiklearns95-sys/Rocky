// Stands in for @xenova/transformers inside the real Whisper worker thread (tests only).
// "Transcribes" a clip as `n=<samples>` and can be told to be slow (busy-loop) or to fail to load.
export const env = {};
export async function pipeline(task, model) {
  if (model === 'bad-model') throw new Error('download failed for bad-model');
  return async (samples, opts) => {
    if (samples[0] === 0.5) { const end = Date.now() + 300; while (Date.now() < end) { /* hog the thread */ } }
    return { text: ` n=${samples.length} model=${model} lang=${opts.language || 'en-model'} ` };
  };
}
