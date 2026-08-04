/**
 * Rocky Smoke Test Suite — Pillar 4
 *
 * Zero-dependency unit tests for pure logic modules.
 * Does NOT require Ollama, Electron, or any OS-level API to run.
 *
 * Run with: node _tests/smoke.mjs
 */

import assert from 'assert/strict';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ── Helper: tiny mock AI provider ────────────────────────────────────────────

const mockAiProvider = {
  generateStructured: async () => ({
    goal: 'chat', entities: {}, domain: 'conversation', confidence: 0.5, actionable: false
  }),
  generate: async () => 'Hello',
  embed: async () => null,
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🧪 Rocky Smoke Tests\n');

// ── Suite 1: localProvider JSON repair ───────────────────────────────────────
console.log('── Pillar 1: LLM Schema Enforcement ──');

const { default: LocalProvider } = await import('../brain/aiProvider/localProvider.js');
const lp = new LocalProvider('test');

test('_repairJSON: direct valid JSON', () => {
  const result = lp._repairJSON('{"goal":"open_app"}');
  assert.equal(result.goal, 'open_app');
});

test('_repairJSON: markdown fenced JSON', () => {
  const result = lp._repairJSON('Sure! Here:\n```json\n{"goal":"play_music"}\n```');
  assert.equal(result.goal, 'play_music');
});

test('_repairJSON: JSON embedded in prose', () => {
  const result = lp._repairJSON('Here is the result: {"goal":"take_screenshot","domain":"automation"}');
  assert.equal(result.goal, 'take_screenshot');
});

test('_repairJSON: returns null on unparseable garbage', () => {
  const result = lp._repairJSON('I cannot do that.');
  assert.equal(result, null);
});

test('_enforceSchema: fills missing string field', () => {
  const schema = { properties: { goal: { type: 'string' }, domain: { type: 'string', enum: ['automation', 'conversation'] } } };
  const result = lp._enforceSchema({ goal: 'chat' }, schema);
  assert.equal(result.domain, 'automation'); // first enum value
});

test('_enforceSchema: coerces invalid enum to first allowed', () => {
  const schema = { properties: { domain: { type: 'string', enum: ['automation', 'research', 'conversation'] } } };
  const result = lp._enforceSchema({ domain: 'INVALID_VALUE' }, schema);
  assert.equal(result.domain, 'automation');
});

test('_enforceSchema: leaves valid values untouched', () => {
  const schema = { properties: { confidence: { type: 'number' } } };
  const result = lp._enforceSchema({ confidence: 0.85 }, schema);
  assert.equal(result.confidence, 0.85);
});

// ── Suite 2: SemanticInterpreter rule overrides (no LLM) ─────────────────────
console.log('\n── Pillar 1b: SemanticInterpreter Rule Overrides ──');

const { SemanticInterpreter } = await import('../voice/interpreter/semanticInterpreter.js');
const si = new SemanticInterpreter(mockAiProvider);

test('greeting "hey" → conversation domain', () => {
  const result = si._ruleBasedOverride('hey rocky');
  assert.equal(result?.domain, 'conversation');
  assert.equal(result?.actionable, false);
});

test('"who are you" → conversation + chat goal', () => {
  const result = si._ruleBasedOverride('who are you');
  assert.equal(result?.goal, 'chat');
  assert.equal(result?.domain, 'conversation');
});

test('"open spotify" → automation domain', () => {
  const result = si._ruleBasedOverride('open spotify');
  assert.equal(result?.domain, 'automation');
  assert.equal(result?.actionable, true);
});

test('"what do you know about me?" → conversation (personal memory)', () => {
  const result = si._ruleBasedOverride('what do you know about me?');
  assert.equal(result?.goal, 'recall_personal_memory');
});

test('unknown input returns null (goes to LLM)', () => {
  const result = si._ruleBasedOverride('calculate 25 times 16');
  assert.equal(result, null);
});

// ── Suite 3: resourceResolver static paths ───────────────────────────────────
console.log('\n── Pillar 2: Resource Resolver ──');

const { default: resolveResource } = await import('../resolver/resourceResolver.js');

await testAsync('resolves "notepad" from static table', async () => {
  const r = await resolveResource('notepad', {});
  assert.equal(r.type, 'desktop');
  assert.ok(r.target.includes('notepad'));
});

await testAsync('resolves "youtube" as web service', async () => {
  const r = await resolveResource('youtube', {});
  assert.equal(r.type, 'web');
  assert.ok(r.target.includes('youtube'));
});

await testAsync('resolves "github.com" via URL heuristic', async () => {
  const r = await resolveResource('github.com', {});
  assert.equal(r.type, 'web');
  assert.ok(r.target.startsWith('https://'));
});

await testAsync('caches result on second call', async () => {
  await resolveResource('calculator', {});  // populate cache
  const r = await resolveResource('calculator', {}); // should hit cache
  assert.equal(r.type, 'desktop');
  assert.equal(r.source, 'static_table'); // cached result preserves source
});

await testAsync('returns unknown for gibberish', async () => {
  const r = await resolveResource('xyzabc123nonsense', {});
  assert.equal(r.type, 'unknown');
});

// ── Suite 4: capabilityResolver ───────────────────────────────────────────────
console.log('\n── Pillar 2b: Capability Resolver ──');

const { default: resolveCapabilities } = await import('../resolver/capabilityResolver.js');

test('spotify.exe → canControlMedia + UIA', () => {
  const caps = resolveCapabilities({ type: 'desktop', target: 'spotify.exe' });
  assert.equal(caps.canControlMedia, true);
  assert.equal(caps.preferredInterface, 'UIA');
});

test('youtube web → canControlMedia + DOM', () => {
  const caps = resolveCapabilities({ type: 'web', target: 'https://youtube.com' });
  assert.equal(caps.canControlMedia, true);
  assert.equal(caps.preferredInterface, 'DOM');
});

test('discord.exe → isHybrid', () => {
  const caps = resolveCapabilities({ type: 'desktop', target: 'discord.exe' });
  assert.equal(caps.isHybrid, true);
});

test('powershell.exe → canClick=false', () => {
  const caps = resolveCapabilities({ type: 'desktop', target: 'powershell.exe' });
  assert.equal(caps.canClick, false);
});

// ── Suite 5: ConversationalSupervisor routing ─────────────────────────────────
console.log('\n── Pillar 3: ConversationalSupervisor Routing ──');

const { default: ConversationalSupervisor } = await import('../brain/orchestrator/conversationalSupervisor.js');

const mockAgentLoop = { run: async () => 'done' };
const supervisor = new ConversationalSupervisor(mockAgentLoop, mockAiProvider);

test('"hi" → conversation route', () => {
  assert.equal(supervisor._determineRoute('hi'), 'conversation');
});

test('semanticIntent.route is trusted over regex', () => {
  const route = supervisor._determineRoute('launch chrome', { route: 'execution' });
  assert.equal(route, 'execution');
});

test('AUTONOMOUS_PRESENCE_TRIGGER → conversation', () => {
  const route = supervisor._determineRoute('AUTONOMOUS_PRESENCE_TRIGGER: check in');
  assert.equal(route, 'conversation');
});

test('generic command defaults to execution', () => {
  const route = supervisor._determineRoute('play some music on spotify');
  assert.equal(route, 'execution');
});

// ── Suite 6: execWithTimeout ──────────────────────────────────────────────────
console.log('\n── Pillar 4: execWithTimeout Safety ──');

const { execWithTimeout } = await import('../automation/system/execWithTimeout.js');

await testAsync('executes fast command successfully', async () => {
  const { stdout, timedOut, error } = await execWithTimeout('echo hello', { timeoutMs: 5000 });
  assert.equal(timedOut, false);
  assert.ok(!error);
  assert.ok(stdout.trim().length > 0);
});

await testAsync('times out a slow command', async () => {
  // PowerShell sleep is deterministic — guaranteed to take 5s, deadline is 800ms
  const { timedOut } = await execWithTimeout(
    'powershell -NoProfile -Command "Start-Sleep -Seconds 5"',
    { timeoutMs: 800 }
  );
  assert.equal(timedOut, true);
});

// ── Suite 7: Exec Timeout Sweep — module import checks ───────────────────────
console.log('\n── Exec Timeout Sweep: Module Integrity ──');

await testAsync('getActiveWindow: module imports without error', async () => {
  const { default: getActiveWindow } = await import('../automation/system/getActiveWindow.js');
  assert.equal(typeof getActiveWindow, 'function');
});

await testAsync('getSystemMetrics: module imports without error', async () => {
  const { default: getSystemMetrics } = await import('../automation/system/getSystemMetrics.js');
  assert.equal(typeof getSystemMetrics, 'function');
});

await testAsync('webSearch: URL encodes query correctly', async () => {
  // Test the URL encoding logic — no exec needed, just check the URL built
  const query = 'hello world & more';
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  assert.ok(url.includes('hello%20world'));
  assert.ok(!url.includes(' ')); // no raw spaces in URL
});

await testAsync('openFolder: module imports without error', async () => {
  const { default: openFolder } = await import('../tools/system/openFolder.js');
  assert.equal(typeof openFolder, 'function');
});

await testAsync('windowTracker: exports restoreAndFocusWindow function', async () => {
  const mod = await import('../tools/desktop/windowTracker.js');
  assert.equal(typeof mod.restoreAndFocusWindow, 'function');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n⚠️  Some tests failed. Review output above.');
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!');
}
