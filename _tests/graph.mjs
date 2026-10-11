/**
 * Knowledge graph tests (needs better-sqlite3): node _tests/graph.mjs
 */
import assert from 'assert/strict';
import { GraphManager } from '../memory/graphManager.js';
import Curiosity from '../memory/curiosity.js';
import { describeAge } from '../memory/timeAgo.js';
import PresenceManager from '../brain/presence/presenceManager.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}
const fresh = async () => { const g = new GraphManager(':memory:'); await g.init(); assert.ok(g.isAvailable()); return g; };

console.log('\nKnowledge graph (SQLite)');

await test('stores a fact and recalls it from a first-person question', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'user', relation: 'crush', object: 'Mugdha', confidence: 0.95 });
  assert.match(await g.getEntityContext('who is my crush'), /user -\[crush\]-> Mugdha/);
});

await test('"I"/"me"/"my" map to the user node', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'I', relation: 'likes', object: 'coffee' });
  await g.upsertFact({ subject: 'me', relation: 'likes', object: 'coffee' });
  assert.equal((await g.queryFacts('what do I like')).length, 1);
});

await test('re-stating a fact does not duplicate it', async () => {
  const g = await fresh();
  for (let i = 0; i < 3; i++) await g.upsertFact({ subject: 'user', relation: 'likes', object: 'tea' });
  assert.equal((await g.queryFacts('my tea')).length, 1);
});

await test('exclusive relation: new value retires the old one (kept as history)', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'user', relation: 'favorite color', object: 'blue' });
  await g.upsertFact({ subject: 'user', relation: 'favorite color', object: 'green' });
  const ctx = await g.getEntityContext('my favorite color');
  assert.match(ctx, /green/);
  assert.doesNotMatch(ctx, /blue/);
  assert.equal(g.db.prepare('SELECT COUNT(*) c FROM edges WHERE valid_to IS NOT NULL').get().c, 1);
});

await test('retireFact removes a fact from answers', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'user', relation: 'likes', object: 'jazz' });
  assert.ok(await g.retireFact({ subject: 'user', relation: 'likes', object: 'jazz' }));
  assert.equal(await g.getEntityContext('my jazz'), '');
});

await test('multi-hop: reaches the brother\'s wife through two edges', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'user', relation: 'brother', object: 'John' });
  await g.upsertFact({ subject: 'John', relation: 'wife', object: 'Priya' });
  const ctx = await g.getEntityContext('tell me about my brother');
  assert.match(ctx, /John -\[wife\]-> Priya/);
});

await test('alias: the user\'s own word resolves to the same entity', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'Chill Mix', relation: 'is_a', object: 'playlist' });
  g.addAlias('my jams', 'Chill Mix');
  assert.match(await g.getEntityContext('play my jams'), /Chill Mix -\[is_a\]-> playlist/);
});

await test('unrelated text returns nothing; bad input is rejected', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'user', relation: 'likes', object: 'tea' });
  assert.equal(await g.getEntityContext('what is the weather'), '');
  assert.equal(await g.upsertFact({ subject: '', relation: 'x', object: 'y' }), false);
});

console.log('\nShared memories (episodes)');

await test('recalls a memory by the person/thing it involved', async () => {
  const g = await fresh();
  await g.addEpisode({ summary: 'Grace and Rocky fixed the login bug', kind: 'milestone', entities: ['login bug'] });
  const eps = await g.recallEpisodes('remember the login bug?');
  assert.equal(eps.length, 1);
  assert.match(eps[0].summary, /login bug/);
});
await test('recalls by words in the summary when no entity matches', async () => {
  const g = await fresh();
  await g.addEpisode({ summary: 'Rocky did for Grace: open spotify' });
  assert.equal((await g.recallEpisodes('what did we do with spotify')).length, 1);
  assert.equal((await g.recallEpisodes('weather tomorrow')).length, 0);
});
await test('duplicate episodes within minutes are stored once', async () => {
  const g = await fresh();
  assert.ok(await g.addEpisode({ summary: 'Rocky did for Grace: open chrome' }));
  assert.equal(await g.addEpisode({ summary: 'Rocky did for Grace: open chrome' }), false);
});
test('describeAge: human wording', () => {
  const now = Date.now();
  assert.equal(describeAge(now - 30e3, now), 'just now');
  assert.equal(describeAge(now - 3 * 3600e3, now), '3 hours ago');
  assert.equal(describeAge(now - 2 * 86400e3, now), '2 days ago');
});

console.log('\nCuriosity');
const clock = () => { let t = 1_000_000_000_000; const f = () => t; f.advance = (ms) => { t += ms; }; return f; };

await test('asks who an unplaced person is, then not again until answered/cooldown', async () => {
  const g = await fresh(); const now = clock();
  await g.upsertFact({ subject: 'Mugdha', relation: 'studies', object: 'law', subjectType: 'person' });
  const c = new Curiosity(g, { now });
  const q = await c.nextQuestion();
  assert.equal(q.kind, 'relationship');
  assert.match(q.text, /Who is Mugdha to you/);
  c.markAsked(q);
  assert.equal(await c.nextQuestion(), null, 'global cooldown');
  now.advance(4 * 3600e3);
  const next = await c.nextQuestion();
  assert.notEqual(next?.key, q.key, 'same topic is not repeated within a week');
});
await test('person already linked to the user is not asked about', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'user', relation: 'brother', object: 'John', objectType: 'person' });
  const q = await new Curiosity(g, { now: clock() }).nextQuestion();
  assert.notEqual(q?.kind, 'relationship');
});
await test('confirms low-confidence guesses; "yes" makes it certain', async () => {
  const g = await fresh(); const now = clock();
  await g.upsertFact({ subject: 'user', relation: 'likes', object: 'jazz', confidence: 0.6, source: 'reflection' });
  const c = new Curiosity(g, { now });
  const q = await c.nextQuestion();
  assert.equal(q.kind, 'confirm');
  assert.match(q.text, /Grace.*likes jazz/);
  c.markAsked(q);
  const reply = await c.answerConfirm(c.takePending(), 'yeah that is right');
  assert.match(reply, /sure/i);
  assert.equal(g.db.prepare("SELECT confidence FROM edges WHERE relation = 'likes'").get().confidence, 0.95);
});
await test('"no" retires the guessed fact', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'user', relation: 'likes', object: 'jazz', confidence: 0.6 });
  const c = new Curiosity(g, { now: clock() });
  c.markAsked(await c.nextQuestion());
  await c.answerConfirm(c.takePending(), 'no not really');
  assert.equal(await g.getEntityContext('my jazz'), '');
});
await test('an answer after the window is ignored; unclear reply is not an answer', async () => {
  const g = await fresh(); const now = clock();
  await g.upsertFact({ subject: 'user', relation: 'likes', object: 'jazz', confidence: 0.6 });
  const c = new Curiosity(g, { now });
  c.markAsked(await c.nextQuestion());
  now.advance(5 * 60e3);
  assert.equal(c.takePending(), null);
  c.markAsked({ key: 'confirm:x', kind: 'confirm', fact: { subject: 'user', relation: 'likes', object: 'jazz' }, text: 'q' });
  assert.equal(await c.answerConfirm(c.takePending(), 'open spotify please'), null);
});
await test('falls back to profile questions, and skips ones already known', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'user', relation: 'works_on', object: 'Rocky' });
  const q = await new Curiosity(g, { now: clock() }).nextQuestion();
  assert.equal(q.kind, 'profile');
  assert.notEqual(q.key, 'profile:occupation');
});

console.log('\nPresence asks a question when curious');
await test('presence speaks the question instead of a generic check-in', async () => {
  const g = await fresh();
  await g.upsertFact({ subject: 'Mugdha', relation: 'studies', object: 'law', subjectType: 'person' });
  const sent = [];
  const bus = { emit: (ev, payload) => sent.push([ev, payload]) };
  const p = new PresenceManager(bus, { curiosity: new Curiosity(g), canSpeak: () => true });
  p.triggerPresence();
  await new Promise(r => setTimeout(r, 50));
  p.stop();
  assert.equal(sent[0][0], 'RESPONSE_READY');
  assert.match(sent[0][1], /Mugdha/);
});
await test('presence stays quiet-by-default when Rocky is busy', async () => {
  const sent = [];
  const p = new PresenceManager({ emit: (ev) => sent.push(ev) }, { curiosity: { nextQuestion: async () => { throw new Error('should not ask'); } }, canSpeak: () => false });
  p.triggerPresence();
  await new Promise(r => setTimeout(r, 20));
  p.stop();
  assert.deepEqual(sent, ['USER_INPUT']);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
