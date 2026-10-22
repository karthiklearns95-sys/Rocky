/** Semantic router (vector fast path) with a REAL LanceDB: node _tests/router.mjs */
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SemanticRouter, CLUSTERS, normalizeVector, decideIntent, routeGuard } from '../brain/orchestrator/semanticRouter.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 4).join('\n     ')}`); failed++; }
}
const realLog = console.log;
const quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = realLog; } };

// A stand-in embedding: words hashed into 64 dimensions (similar words -> similar vectors).
const DIM = 64;
const hash = (w) => { let h = 7; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const embedText = (t) => { const v = new Array(DIM).fill(0); for (const w of t.toLowerCase().split(/\W+/).filter(Boolean)) v[hash(w) % DIM] += 1; return v; };
const provider = (extra = {}) => { const calls = []; return { calls, embed: async (t) => { calls.push(t); return extra.embed ? extra.embed(t) : embedText(t); } }; };

const settings = { enabled: true, maxDistance: 0.12, minMargin: 0.04, maxWords: 8, queryTimeoutMs: 300, seedTimeoutMs: 2000, retrySeedMs: 30000 };
const noCatalog = { findMentioned: () => null };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-router-'));
const make = (over = {}) => new SemanticRouter({ dbPath: tmp(), settings, catalog: noCatalog, ...over });
const said = (text, extra = {}) => ({ rawInput: JSON.stringify({ goal: 'whatever', entities: {}, rawInput: text }), userText: text, ...extra });
const tools = (plan) => plan?.map((s) => s.tool);

console.log('\nPure pieces');
await test('vectors are scaled to unit length; garbage is refused', () => {
  const v = normalizeVector([3, 4]);
  assert.deepEqual(v.map((x) => +x.toFixed(3)), [0.6, 0.8]);
  assert.equal(normalizeVector([0, 0]), null); assert.equal(normalizeVector([NaN, 1]), null); assert.equal(normalizeVector('x'), null);
});
await test('intent choice: close enough AND clearly ahead of every other intent', () => {
  const o = { maxDistance: 0.12, minMargin: 0.04 };
  const rows = (...r) => r.map(([intent, d, text = intent]) => ({ intent, _distance: d, text }));
  assert.equal(decideIntent(rows(['A', 0.05], ['B', 0.30]), o).intent, 'A');
  assert.match(decideIntent(rows(['A', 0.20], ['B', 0.40]), o).reason, /too far/);
  assert.match(decideIntent(rows(['A', 0.08], ['B', 0.10]), o).reason, /too close/);
  assert.equal(decideIntent(rows(['A', 0.05], ['A', 0.06], ['B', 0.30]), o).intent, 'A', 'two phrases of the same intent are not a rival');
  assert.match(decideIntent([], o).reason, /no examples/);
});
await test('guards: opposites, other targets, long sentences', () => {
  assert.equal(routeGuard('open notepad', 'LaunchApp_Notepad'), null);
  assert.match(routeGuard('close notepad', 'LaunchApp_Notepad'), /opposite/);
  assert.match(routeGuard("don't open notepad", 'LaunchApp_Notepad'), /opposite/);
  assert.match(routeGuard('play believer on youtube', 'LaunchApp_Spotify'), /youtube/);
  assert.match(routeGuard('play music on netflix', 'LaunchApp_Spotify'), /netflix/);
  assert.equal(routeGuard('play music on spotify', 'LaunchApp_Spotify'), null, 'its own app is fine');
  assert.match(routeGuard('please open notepad and write down the whole shopping list for tomorrow', 'LaunchApp_Notepad'), /too long/);
  assert.match(routeGuard('take a note', 'LaunchApp_Notepad', { mentioned: () => 'Obsidian' }), /another installed app/);
  assert.equal(routeGuard('take a note', 'LaunchApp_Notepad', { mentioned: () => 'Notepad++ (notepad)' }), null);
});

console.log('\nWith a real vector database');
await test('before the examples are embedded the router steps aside at once (a command is never delayed)', async () => {
  const r = make(); const p = provider();
  const t0 = Date.now();
  const plan = await quiet(() => r.getDeterministicRoute(said('take a note'), p));
  assert.equal(plan, null);
  assert.ok(Date.now() - t0 < 200);
  await r.warming;                                   // let the background seeding finish before the next test
});
await test('warm-up embeds every example once, then an exact phrase takes the fast path', async () => {
  const r = make(); const p = provider();
  assert.equal(await quiet(() => r.warmUp(p)), true);
  assert.equal(p.calls.length, CLUSTERS.length);
  const plan = await quiet(() => r.getDeterministicRoute(said('take a note'), p));
  assert.deepEqual(tools(plan), ['open_resource', 'waitForAppReady', 'focusWindow']);
  assert.equal(plan[0].input.query, 'notepad');
  assert.equal(p.calls.at(-1), 'take a note', 'it embedded what she SAID, not the interpreter JSON');
});
await test('opposites and other targets are left to the planner even though they embed nearly the same', async () => {
  const r = make(); const p = provider(); await quiet(() => r.warmUp(p));
  for (const t of ['close notepad', 'play music on youtube', 'stop playing music', 'open notepad and write the shopping list for tomorrow morning please']) {
    assert.equal(await quiet(() => r.getDeterministicRoute(said(t), p)), null, t);
  }
});
await test('something unrelated is far from every example: no fast path', async () => {
  const r = make(); const p = provider(); await quiet(() => r.warmUp(p));
  assert.equal(await quiet(() => r.getDeterministicRoute(said('what is the capital of france'), p)), null);
});
await test('the vector path can be switched off; installed-app launches still work without it', async () => {
  const r = make({ settings: { ...settings, enabled: false } }); const p = provider(); await quiet(() => r.warmUp(p));
  assert.equal(await quiet(() => r.getDeterministicRoute(said('take a note'), p)), null);
  assert.deepEqual(tools(await quiet(() => r.getDeterministicRoute(said('notepad'), p))), ['open_resource', 'waitForAppReady', 'focusWindow']);
});
await test('Ollama not up at start-up: nothing half-built, and it tries again after the cooldown', async () => {
  let t = 1000; const r = make({ now: () => t });
  const down = provider({ embed: () => null });
  assert.equal(await quiet(() => r.warmUp(down)), false);
  assert.equal(r.table, null, 'no partial table');
  const calls = down.calls.length;
  assert.equal(await quiet(() => r.warmUp(down)), false);
  assert.equal(down.calls.length, calls, 'not hammered during the cooldown');
  t += 31000;
  assert.equal(await quiet(() => r.warmUp(provider())), true);
});
await test('a different embedding size (e.g. a fallback model answered) is skipped, not an error', async () => {
  const r = make(); await quiet(() => r.warmUp(provider()));
  const odd = provider({ embed: () => new Array(10).fill(0.3) });
  assert.equal(await quiet(() => r.getDeterministicRoute(said('take a note'), odd)), null);
});
await test('a slow or failing embedding step never holds up or breaks the command', async () => {
  const r = make(); await quiet(() => r.warmUp(provider()));
  const slow = provider({ embed: () => new Promise((res) => setTimeout(() => res(embedText('take a note')), 2000)) });
  const t0 = Date.now();
  assert.equal(await quiet(() => r.getDeterministicRoute(said('take a note'), slow)), null);
  assert.ok(Date.now() - t0 < 1000);
  const boom = provider({ embed: () => { throw new Error('ollama down'); } });
  assert.equal(await quiet(() => r.getDeterministicRoute(said('take a note'), boom)), null);
});
await test('changing the example phrases replaces the old table (no stale examples)', async () => {
  const dbPath = tmp();
  const a = new SemanticRouter({ dbPath, settings, catalog: noCatalog });
  await quiet(() => a.warmUp(provider()));
  const b = new SemanticRouter({ dbPath, settings, catalog: noCatalog, clusters: CLUSTERS.slice(0, 5) });
  await quiet(() => b.warmUp(provider()));
  const names = (await b.db.tableNames()).filter((n) => n.startsWith('fast_path'));
  assert.equal(names.length, 1);
  assert.equal(await b.table.countRows(), 5);
});
await test('an existing table is reused after a restart (no re-embedding)', async () => {
  const dbPath = tmp();
  await quiet(() => new SemanticRouter({ dbPath, settings, catalog: noCatalog }).warmUp(provider()));
  const again = new SemanticRouter({ dbPath, settings, catalog: noCatalog });
  const p = provider();
  // the phrases are embedded to learn the size, but the stored table is what gets searched
  assert.equal(await quiet(() => again.warmUp(p)), true);
  assert.equal(await again.table.countRows(), CLUSTERS.length);
});

console.log('\nPlans');
await test('WhatsApp with a contact but no message opens the chat and does NOT send anything', async () => {
  const r = make();
  const plan = r._buildRoutePlan('LaunchApp_WhatsApp', { ...said('text mom'), intentData: { entities: { contact: 'Mom' } } });
  assert.ok(plan.some((s) => s.tool === 'typeText' && s.input.text === 'Mom'));
  assert.equal(plan.filter((s) => s.tool === 'typeText').length, 1, 'only the contact is typed');
  assert.equal(plan.at(-1).input.key, '{ENTER}');
  const withMsg = r._buildRoutePlan('LaunchApp_WhatsApp', { ...said('text mom hi'), intentData: { entities: { contact: 'Mom', message: 'on my way' } } });
  assert.deepEqual(withMsg.filter((s) => s.tool === 'typeText').map((s) => s.input.text), ['Mom', 'on my way']);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
