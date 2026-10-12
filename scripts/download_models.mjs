// Download the speech models Rocky needs, once, while you are online:
//   node scripts/download_models.mjs                       the configured model + fallbacks
//   node scripts/download_models.mjs Xenova/whisper-small.en
//
// Models are kept in ~/.rocky/models (override: ROCKY_MODEL_CACHE), outside node_modules, so
// reinstalling dependencies does not throw them away. Rocky itself runs offline afterwards.
import os from 'os';
import path from 'path';
import config from '../config/app.config.js';

const { pipeline, env } = await import('@xenova/transformers');
env.allowLocalModels = false;
env.useBrowserCache = false;
env.cacheDir = config.stt.cacheDir || path.join(os.homedir(), '.rocky', 'models');

const models = process.argv.slice(2).length ? process.argv.slice(2) : [config.stt.model, ...config.stt.fallbackModels];
console.log(`Saving to ${env.cacheDir}\n`);

let failed = 0;
for (const model of models) {
  const started = Date.now();
  let lastPct = -10;
  try {
    await pipeline('automatic-speech-recognition', model, {
      progress_callback: (p) => {
        if (p.status === 'progress' && p.progress - lastPct >= 10) { lastPct = p.progress; process.stdout.write(`  ${model}: ${Math.round(p.progress)}%\r`); }
      },
    });
    console.log(`  ${model}: ready (${((Date.now() - started) / 1000).toFixed(1)} s)      `);
  } catch (err) {
    failed++;
    console.error(`  ${model}: FAILED - ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
