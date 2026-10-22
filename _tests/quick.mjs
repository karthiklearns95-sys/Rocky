/** Questions Rocky answers himself (no model, no plan): node _tests/quick.mjs */
import assert from 'assert/strict';
import { quickAnswer, evaluate } from '../brain/quickAnswers.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ')}`); failed++; }
}
const now = new Date(2026, 9, 22, 18, 5);   // Thursday 22 October 2026, 18:05 local
const ask = (t) => quickAnswer(t, { now, locale: 'en-GB' });

console.log('\nAnswered directly');
await test('the time, however it is asked (typed or heard, with or without "Rocky")', () => {
  for (const t of ['what time is it', 'Rocky, what time is it?', 'whats the time', "what's the time now", 'tell me the time please', 'time'])
    assert.equal(ask(t), 'Grace, it is 18:05.', t);
});
await test('the date and the day', () => {
  for (const t of ['what is the date today', "what's today's date", 'what day is it', 'which day is today'])
    assert.equal(ask(t), 'Grace, today is Thursday, 22 October 2026.', t);
});
await test('simple sums in words or symbols', () => {
  assert.equal(ask('what is 12 times 4'), 'Grace, 12 times 4 is 48.');
  assert.equal(ask('calculate (3 + 5) * 2'), 'Grace, (3 + 5) * 2 is 16.');
  assert.equal(ask('what is 15 percent of 200'), 'Grace, 15 percent of 200 is 30.');
  assert.equal(ask('whats 10 divided by 4'), 'Grace, 10 divided by 4 is 2.5.');
  assert.equal(ask('what is 1,200 minus 1'), 'Grace, 1,200 minus 1 is 1199.');
  assert.equal(ask('what is 7 x 6'), 'Grace, 7 x 6 is 42.');
});

console.log('\nLeft to the rest of Rocky');
await test('anything else is not answered here', () => {
  for (const t of ['what is the capital of france', 'open notepad', 'what time does the shop open', 'what is 5', 'what is 1/0',
    'what is the time in tokyo', 'calculate my taxes', 'what is 2 + process.exit()', ''])
    assert.equal(ask(t), null, t);
});
await test('the arithmetic parser never runs code and rejects malformed input', () => {
  assert.equal(evaluate('2+3*4'), 14);
  assert.equal(evaluate('-(2+3)'), -5);
  assert.equal(evaluate('2+'), null);
  assert.equal(evaluate('(2+3'), null);
  assert.equal(evaluate('2 3'), null);
  assert.equal(evaluate('constructor'), null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
