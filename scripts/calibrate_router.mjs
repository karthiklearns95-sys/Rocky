// Tune the vector fast path with YOUR embedding model.   node scripts/calibrate_router.mjs
// Needs Ollama running with the embedding model (default nomic-embed-text).
//
// For a list of phrases that SHOULD take the fast path and phrases that must NOT, it prints how far
// each is from the nearest example (cosine distance, 0 = identical), what the router would do, and
// a suggested ROCKY_ROUTER_MAX_DISTANCE. Add your own phrases to the lists below.
import fs from 'fs';
import os from 'os';
import path from 'path';
import LocalProvider from '../brain/aiProvider/localProvider.js';
import config from '../config/app.config.js';
import { SemanticRouter } from '../brain/orchestrator/semanticRouter.js';

const SHOULD = [
  'open notepad', 'take a note', 'jot this down', 'write something down', 'open the notepad',
  'play some music', 'put on some tunes', 'play a song', 'start spotify',
  'open calculator', 'do some math', 'open chrome', 'browse the web', 'open whatsapp', 'text my friend',
];
const SHOULD_NOT = [
  'close notepad', 'stop the music', 'what is the weather today', 'play believer on youtube', 'search for cats',
  'send an email to john', 'open the pod bay doors', 'turn the volume up', 'what time is it', 'tell me a joke',
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-cal-'));
const router = new SemanticRouter({ dbPath: tmp, settings: { ...config.router, enabled: true } });
const ai = new LocalProvider();

const log = console.log;
log(`Embedding ${router.clusters.length} example phrases with ${config.models.embedding} (the first one can take up to a minute while Ollama loads the model)...`);
console.log = () => {};
const ok = await router.warmUp(ai);
console.log = log;
if (!ok) { log('Could not embed the example phrases. Is Ollama running, and is the model installed?  (ollama pull nomic-embed-text)'); process.exit(1); }
log(`Embedding model: ${config.models.embedding}, ${router.dim} dimensions. Current threshold: ${config.router.maxDistance}, margin ${config.router.minMargin}.\n`);

async function measure(text) {
  const { normalizeVector } = await import('../brain/orchestrator/semanticRouter.js');
  const v = normalizeVector(await ai.embed(text));
  const rows = (await router.table.search(v).distanceType('cosine').limit(6).toArray()).sort((a, b) => a._distance - b._distance);
  const best = rows[0], rival = rows.find((r) => r.intent !== best.intent);
  return { text, best, distance: best._distance, margin: rival ? rival._distance - best._distance : 1 };
}

const show = (m, tag) => log(`${tag}  ${m.distance.toFixed(3)}  margin ${m.margin.toFixed(3)}  "${m.text}"  ~ "${m.best.text}"`);
const pos = [], neg = [];
log('Should take the fast path:');
for (const t of SHOULD) { const m = await measure(t); pos.push(m); show(m, m.distance <= config.router.maxDistance && m.margin >= config.router.minMargin ? 'hit ' : 'MISS'); }
log('\nMust NOT (distance should be larger):');
for (const t of SHOULD_NOT) { const m = await measure(t); neg.push(m); show(m, m.distance <= config.router.maxDistance && m.margin >= config.router.minMargin ? 'WRONG' : 'ok   '); }

const worstWanted = Math.max(...pos.map((m) => m.distance)), nearestUnwanted = Math.min(...neg.map((m) => m.distance));
log(`\nFurthest wanted phrase: ${worstWanted.toFixed(3)}. Nearest unwanted phrase: ${nearestUnwanted.toFixed(3)}.`);
if (worstWanted < nearestUnwanted) {
  const mid = (worstWanted + nearestUnwanted) / 2;
  log(`They separate cleanly. A safe threshold: ROCKY_ROUTER_MAX_DISTANCE=${(Math.min(mid, nearestUnwanted - 0.02)).toFixed(2)}`);
} else {
  const safe = nearestUnwanted - 0.02;
  log(`They overlap. Stay strict: ROCKY_ROUTER_MAX_DISTANCE=${Math.max(0.03, safe).toFixed(2)} (some wanted phrases will go to the planner, which is fine).`);
}
log('\n(Unwanted phrases are also stopped by the word guards: opposites like "close", and other apps/sites by name.)');
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
