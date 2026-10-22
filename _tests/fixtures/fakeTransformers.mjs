// Stands in for @xenova/transformers inside the real Whisper worker thread (tests only).
// "Transcribes" a clip as `n=<samples>` and can be told to be slow (busy-loop) or to fail to load.
export const env = {};
export async function pipeline(task, model) {
  // What onnxruntime prints while loading a real model, plus one line that matters.
  if (model === 'noisy.en') {
    for (let i = 0; i < 5; i++) process.stderr.write(`2026-10-22 17:52:07.2 [W:onnxruntime:, graph.cc:3490 onnxruntime::Graph::CleanUnusedInitializersAndNodeArgs] Removing initializer 'c${i}'. It is not used by any node and should be removed from the model.\n`);
    process.stderr.write('real problem: disk is full\n');
  }
  if (model === 'bad-model') throw new Error('download failed for bad-model');
  return async (samples, opts) => {
    if (samples[0] === 0.5) { const end = Date.now() + 300; while (Date.now() < end) { /* hog the thread */ } }
    return { text: ` n=${samples.length} model=${model} lang=${opts.language || 'en-model'} ` };
  };
}
