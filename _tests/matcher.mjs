/** Element/OCR matching tests (no dependencies): node _tests/matcher.mjs */
import assert from 'assert/strict';
import { cleanQuery, parseRect, rankElements, matchOcrLines } from '../tools/system/elementMatcher.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}
const el = (Name, ControlType, BoundingRectangle = '100,100,80,30', extra = {}) => ({ Name, ControlType, BoundingRectangle, AutomationId: '', ...extra });

console.log('\nElement matching');
test('cleanQuery strips the action and control words', () => {
  assert.equal(cleanQuery('click the Send button'), 'send');
  assert.equal(cleanQuery('Press the OK button please'), 'ok');
  assert.equal(cleanQuery('button'), 'button', 'keeps the text if everything is filler');
});
test('parseRect handles the formats we get, rejects empty and infinite', () => {
  assert.deepEqual(parseRect('10,20,100,40'), { x: 10, y: 20, w: 100, h: 40, cx: 60, cy: 40 });
  assert.equal(parseRect('0,0,0,0'), null);
  assert.equal(parseRect('Infinity,Infinity,-Infinity,-Infinity'), null);
  assert.equal(parseRect(undefined), null);
});
test('exact name beats partial', () => {
  const r = rankElements([el('Send later', 'ControlType.Button', '10,10,50,20'), el('Send', 'ControlType.Button', '200,10,50,20')], 'click the send button');
  assert.equal(r[0].element.Name, 'Send');
});
test('a clickable control beats a label with the same text', () => {
  const r = rankElements([el('Settings', 'ControlType.Text', '10,10,50,20'), el('Settings', 'ControlType.Button', '200,10,50,20')], 'settings');
  assert.equal(r[0].element.ControlType, 'ControlType.Button');
});
test('does NOT match on a single unrelated long word (old behaviour did)', () => {
  // Old rule: any word >3 chars of the query found anywhere in a name. "open settings" matched "Open file".
  const r = rankElements([el('Open file', 'ControlType.Button'), el('Close', 'ControlType.Button')], 'open settings');
  assert.equal(r.length, 0);
});
test('substring match is allowed but ranks below whole-word', () => {
  const r = rankElements([el('Settings', 'ControlType.Button', '1,1,10,10'), el('Reset', 'ControlType.Button', '50,1,10,10')], 'set');
  assert.ok(r.every((m) => m.score < 0.7));
});
test('offscreen and zero-size elements are never returned', () => {
  const r = rankElements([el('Save', 'ControlType.Button', '10,10,50,20', { IsOffscreen: true }), el('Save', 'ControlType.Button', '0,0,0,0')], 'save');
  assert.equal(r.length, 0);
});
test('automation id match works when the name is empty', () => {
  const r = rankElements([{ Name: '', AutomationId: 'SearchBox', ControlType: 'ControlType.Edit', BoundingRectangle: '5,5,100,20' }], 'searchbox');
  assert.equal(r.length, 1);
});
test('returns the centre of the element', () => {
  const [m] = rankElements([el('Play', 'ControlType.Button', '100,200,40,40')], 'play');
  assert.deepEqual([m.x, m.y], [120, 220]);
});
test('multi-word names: partial token overlap above half counts', () => {
  const r = rankElements([el('New Tab', 'ControlType.Button')], 'open a new tab');
  assert.equal(r.length, 1);
});

console.log('\nOCR matching');
const line = (...ws) => ({ text: ws.map((w) => w[0]).join(' '), words: ws.map(([t, x, y = 10, w = 60, h = 20]) => ({ t, x, y, w, h })) });
test('clicks the matched word, not the middle of the line', () => {
  const m = matchOcrLines([line(['Home', 0], ['Settings', 100], ['About', 400])], 'settings');
  assert.equal(m.text, 'Settings');
  assert.equal(m.x, 130);           // centre of the "Settings" word (100..160), not the line centre (~230)
});
test('multi-word phrase spans the right words', () => {
  const m = matchOcrLines([line(['Sign', 0], ['in', 70], ['with', 140], ['Google', 210])], 'sign in');
  assert.equal(m.text, 'Sign in');
  assert.equal(m.x, 65);            // 0..130
});
test('whole-word match outranks a partial hit elsewhere', () => {
  const m = matchOcrLines([line(['Resetting', 0, 300]), line(['Set', 0, 50])], 'set');
  assert.equal(m.y, 60);
});
test('no match returns null; handles bad input', () => {
  assert.equal(matchOcrLines([line(['Hello', 0])], 'goodbye'), null);
  assert.equal(matchOcrLines(null, 'x'), null);
  assert.equal(matchOcrLines([], ''), null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
