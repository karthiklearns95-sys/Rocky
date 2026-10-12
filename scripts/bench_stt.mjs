// How good and how fast is each Whisper model on YOUR voice and YOUR machine?
//   node scripts/bench_stt.mjs path/to/clip.wav [model ...]
//
// Record a short clip of yourself saying a few typical commands ("Rocky, open Spotify and play
// something relaxing"), then compare. Defaults: tiny.en, base.en, small.en.
// Models are downloaded on first use (needs internet once); see scripts/download_models.mjs.
import fs from 'fs';
import os from 'os';
import path from 'path';
import config from '../config/app.config.js';
import { createTranscriber } from '../voice/stt/transcriberCore.js';
import { analyzeSamples } from '../voice/stt/audioGate.js';

const [clip, ...models] = process.argv.slice(2);
if (!clip || !fs.existsSync(clip)) {
  console.log('Usage: node scripts/bench_stt.mjs path/to/clip.wav [model ...]');
  process.exit(clip ? 1 : 0);
}
const list = models.length ? models : ['Xenova/whisper-tiny.en', 'Xenova/whisper-base.en', 'Xenova/whisper-small.en'];

const { default: wavefile } = await import('wavefile');
const wav = new wavefile.WaveFile(fs.readFileSync(clip));
wav.toSampleRate(16000);
let samples = wav.getSamples(false, Float32Array);
if (Array.isArray(samples)) samples = samples[0];
const stats = analyzeSamples(samples);
console.log(`Clip: ${(stats.durationMs / 1000).toFixed(1)} s, loudness ${stats.rms.toFixed(3)}\n`);

const { pipeline, env } = await import('@xenova/transformers');
env.allowLocalModels = false;
env.useBrowserCache = false;
env.cacheDir = config.stt.cacheDir || path.join(os.homedir(), '.rocky', 'models');

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log('model'.padEnd(26) + 'load'.padEnd(10) + 'transcribe'.padEnd(13) + 'text');
for (const model of list) {
  try {
    const t = createTranscriber({ models: [model], loadPipeline: (m) => pipeline('automatic-speech-recognition', m) });
    let t0 = Date.now();
    await t.ensureLoaded();
    const load = Date.now() - t0;
    await t.transcribe(samples);                       // warm-up (first run compiles the graph)
    const times = []; let text = '';
    for (let i = 0; i < 3; i++) { t0 = Date.now(); text = (await t.transcribe(samples)).text; times.push(Date.now() - t0); }
    console.log(model.padEnd(26) + `${(load / 1000).toFixed(1)} s`.padEnd(10) + `${median(times)} ms`.padEnd(13) + text);
  } catch (err) {
    console.log(model.padEnd(26) + `FAILED: ${err.message}`);
  }
}
