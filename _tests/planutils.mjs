/** Helpers that read the user's request (no dependencies): node _tests/planutils.mjs */
import assert from 'assert/strict';
import { userTextOf, ctxText, extractTextToType, extractSearchText, extractMathExpression, inferAppName } from '../brain/orchestrator/planUtils.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}
const json = (rawInput, extra = {}) => JSON.stringify({ goal: 'g', entities: {}, domain: 'automation', rawInput, ...extra });

console.log('\nHer words vs the interpreter JSON');
test('userTextOf: plain text stays as is', () => {
  assert.equal(userTextOf('open spotify'), 'open spotify');
  assert.equal(userTextOf(''), '');
  assert.equal(userTextOf(undefined), '');
});
test('userTextOf: pulls her words out of the interpreter JSON (case and punctuation kept)', () => {
  assert.equal(userTextOf(json('Write "Buy Milk", please')), 'Write "Buy Milk", please');
  assert.equal(userTextOf(JSON.stringify({ goal: 'g', text: 'from text field' })), 'from text field');
});
test('userTextOf: JSON without her words, broken JSON and braces in a sentence are left alone', () => {
  const noWords = JSON.stringify({ goal: 'g', entities: {} });
  assert.equal(userTextOf(noWords), noWords);
  assert.equal(userTextOf('{not json'), '{not json');
  assert.equal(userTextOf('{ what is 2+2? }'), '{ what is 2+2? }');
});
test('ctxText prefers the value computed when the run started', () => {
  assert.equal(ctxText({ userText: 'a', rawInput: json('b') }), 'a');
  assert.equal(ctxText({ rawInput: json('b') }), 'b');
});
test('text to type is her quoted words, not the first JSON key', () => {
  assert.equal(extractTextToType(userTextOf(json('open notepad and write "buy milk"'))), 'buy milk');
  assert.notEqual(extractTextToType(json('write "x"')), 'x', 'the raw JSON is exactly what must not be searched');
});
test('maths: "times" keeps its operator (the * used to be stripped: "12 times 3" -> "12 3")', () => {
  const ex = (t) => extractMathExpression({ rawInput: json(t), intentData: { entities: {} } });
  assert.equal(ex('what is 12 times 3'), '12 * 3');
  assert.equal(ex('7 plus 8'), '7 + 8');
  assert.equal(ex('20 divided by 4'), '20 / 4');
  assert.equal(ex('10 minus 2'), '10 - 2');
  assert.equal(ex('what is 2 multiplied by 5'), '2 * 5');
});
test('search text and app inference work from her sentence', () => {
  const ctx = { rawInput: json('play Believer on spotify'), intentData: { entities: {} } };
  assert.equal(extractSearchText(ctx), 'Believer');
  assert.equal(inferAppName(ctx), 'spotify');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
