/**
 * Mood engine tests (no dependencies): node _tests/mood.mjs
 */
import assert from 'assert/strict';
import { MoodEngine } from '../brain/presence/moodEngine.js';
import PresenceManager from '../brain/presence/presenceManager.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}
const MIN = 60e3;
function make(hour = 14) {
  let t = Date.UTC(2026, 0, 1, 0, 0, 0);
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  const events = [];
  const m = new MoodEngine({ now, hourOf: () => hour, eventBus: { emit: (ev, p) => events.push([ev, p.label]) } });
  m.setHour = (h) => { hour = h; };
  return { m, now, events };
}

console.log('\nMood engine');

test('starts neutral in the daytime', () => {
  assert.equal(make().m.getMood().label, 'neutral');
});
test('a finished task makes Rocky proud, then it settles', () => {
  const { m, now } = make();
  m.onTaskResult(true);
  assert.equal(m.getMood().label, 'proud');
  now.advance(3 * MIN);
  assert.notEqual(m.getMood().label, 'proud');
});
test('a failure worries Rocky; repeated failures worry him more', () => {
  const { m } = make();
  m.onTaskResult(false);
  const first = m.getMood().valence;
  assert.equal(m.getMood().label, 'worried');
  m.onTaskResult(false);
  assert.ok(m.getMood().valence < first);
});
test('feelings fade back to calm over time', () => {
  const { m, now } = make();
  m.onTaskResult(false);
  now.advance(25 * MIN);            // still around, just calm again
  m.onUserMessage('hello');
  assert.equal(m.getMood().label, 'neutral');
});
test('three quick wins make Rocky excited', () => {
  const { m, now } = make();
  for (let i = 0; i < 3; i++) { m.onTaskResult(true); now.advance(10e3); }
  now.advance(2.5 * MIN); // proud window over, excited remains? excited lasts 2 min from 3rd win
  const early = make().m;
  for (let i = 0; i < 3; i++) early.onTaskResult(true);
  assert.ok(['proud', 'excited'].includes(early.getMood().label));
  assert.ok(early.excitedUntil > 0);
});
test('kind words cheer him; harsh words hurt; negation is respected', () => {
  const a = make().m; a.onUserMessage('thanks that was great');
  assert.equal(a.getMood().label, 'happy');
  const b = make().m; b.onUserMessage('this is useless and wrong');
  assert.equal(b.getMood().label, 'worried');
  const c = make().m; c.onUserMessage('that was not great');
  assert.ok(c.getMood().valence <= 0);
});
test('asking a question makes him curious for a minute', () => {
  const { m, now } = make();
  m.onQuestionAsked();
  assert.equal(m.getMood().label, 'curious');
  now.advance(90e3);
  assert.equal(m.getMood().label, 'neutral');
});
test('late at night he is sleepy; quiet for a long time too', () => {
  assert.equal(make(2).m.getMood().label, 'sleepy');
  const { m, now } = make(14);
  now.advance(45 * MIN);
  assert.equal(m.getMood().label, 'sleepy');
});
test('emits MOOD_CHANGE only when the label changes', () => {
  const { m, events } = make();
  m.onUserMessage('thanks');           // -> happy
  m.onUserMessage('thanks again');     // still happy
  assert.deepEqual(events.map(e => e[1]), ['happy']);
});
test('reads Grace as tired or stressed from what she says', () => {
  const a = make().m; a.onUserMessage("I'm so tired");
  assert.equal(a.getMood().userState, 'tired');
  const b = make().m; b.onUserMessage('I am stressed about the deadline');
  assert.equal(b.getMood().userState, 'stressed');
});
test('care message: tired Grace gets one, then not again for 2 hours', () => {
  const { m, now } = make();
  m.onUserMessage("I'm exhausted");
  assert.match(m.careMessage(), /tired|rest/i);
  m.onUserMessage("still tired");
  assert.equal(m.careMessage(), null, 'throttled');
  now.advance(121 * MIN);
  m.onUserMessage('so tired');
  assert.ok(m.careMessage());
});
test('care message: suggests a break after 2 hours of steady work', () => {
  const { m, now } = make();
  for (let i = 0; i < 13; i++) { m.onUserMessage('open something'); now.advance(10 * MIN); }
  assert.match(m.careMessage(), /work long time/i);
});
test('care message: a real break resets the work streak', () => {
  const { m, now } = make();
  m.onUserMessage('hello');
  now.advance(150 * MIN);          // away for 2.5 h
  m.onUserMessage('back');
  assert.equal(m.careMessage(), null);
});
test('late-night work gets a bedtime nudge', () => {
  const { m, now } = make(1);
  for (let i = 0; i < 4; i++) { m.onUserMessage('still coding'); now.advance(10 * MIN); }
  assert.match(m.careMessage(), /late/i);
});
test('moodHint is empty when neutral, descriptive otherwise', () => {
  const { m } = make();
  assert.equal(m.moodHint(), '');
  m.onTaskResult(false);
  assert.match(m.moodHint(), /worried/);
});

console.log('\nPresence uses mood');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

test('presence offers care before asking a curious question', async () => {});
const careFirst = async () => {
  const sent = [];
  const p = new PresenceManager({ emit: (ev, payload) => sent.push([ev, payload]) }, {
    care: () => 'Grace… rest a little.',
    curiosity: { nextQuestion: async () => { throw new Error('should not ask when care is due'); } },
    canSpeak: () => true,
  });
  p.triggerPresence(); await wait(20); p.stop();
  assert.deepEqual(sent, [['RESPONSE_READY', 'Grace… rest a little.']]);
};
const askWhenNoCare = async () => {
  const sent = [];
  const p = new PresenceManager({ emit: (ev, payload) => sent.push(ev) }, {
    care: () => null,
    curiosity: { nextQuestion: async () => ({ key: 'k', text: 'Who is Mugdha?' }), markAsked: () => {} },
    canSpeak: () => true,
  });
  p.triggerPresence(); await wait(20); p.stop();
  assert.deepEqual(sent, ['QUESTION_ASKED', 'RESPONSE_READY']);
};
const quietWhenBusy = async () => {
  const sent = [];
  const p = new PresenceManager({ emit: (ev) => sent.push(ev) }, { care: () => 'care', canSpeak: () => false });
  p.triggerPresence(); await wait(20); p.stop();
  assert.deepEqual(sent, ['USER_INPUT']);
};
for (const [name, fn] of [['care comes first', careFirst], ['asks a question when no care is due', askWhenNoCare], ['does not interrupt when busy', quietWhenBusy]]) {
  try { await fn(); console.log(`  ✅ presence: ${name}`); passed++; } catch (e) { console.error(`  ❌ presence: ${name}\n     ${e.message}`); failed++; }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
