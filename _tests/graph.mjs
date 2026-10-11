/**
 * Knowledge graph tests (needs better-sqlite3): node _tests/graph.mjs
 */
import assert from 'assert/strict';
import { GraphManager } from '../memory/graphManager.js';

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

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
