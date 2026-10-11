// Runs the REAL AgentLoop against scripted tools/planner/model and records everything it does.
//
// A trace has two channels:
//   main - things on the loop's own call chain, in order (tool calls, planner/model calls, window reads,
//          verification, events). Compared exactly.
//   side - fire-and-forget bookkeeping (memory, graph, episodes, catalog, delegation). Compared as a
//          sorted list, because those run concurrently with the main chain.
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';

process.env.ROCKY_TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-harness-'));
await import('./register.mjs');

const { default: AgentLoop } = await import('../../brain/orchestrator/agentLoop.js');
const { default: eventBus } = await import('../../services/eventBus.js');
const { workflowCache } = await import('../../memory/workflowCache.js');
const { default: voiceController } = await import('../../voice/voiceController.js');
const uiMapStore = await import('../../memory/uiMapStore.js');

// ── instrumentation of the real modules we keep ──
for (const m of ['get', 'set']) {
  const orig = workflowCache[m].bind(workflowCache);
  workflowCache[m] = (...a) => {
    const r = orig(...a);
    globalThis.__T?.side(`workflowCache.${m}`, m === 'get' ? [a[0], a[1], r ? r.map((s) => s.tool) : null] : [a[0], a[1], a[2].map((s) => s.tool)]);
    return r;
  };
}
for (const ev of ['MOVE_AGENT', 'TASK_RESULT', 'RESPONSE_READY']) {
  eventBus.on(ev, (p) => globalThis.__T?.main(`event.${ev}`, p));
}
process.on('aura_telemetry', (p) => globalThis.__T?.main('telemetry', p));

const realSetTimeout = globalThis.setTimeout;
const clean = (v) => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === '_signal' ? undefined : x)));

function lcg(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }

export async function runScenario(def) {
  const main = [], side = [];
  const abortCtl = new AbortController();
  const h = { abort: () => abortCtl.abort(), signal: abortCtl.signal, voiceController, eventBus };
  const script = typeof def.script === 'function' ? def.script(h) : (def.script || {});
  const T = {
    main: (k, v) => main.push([k, clean(v)]),
    side: (k, v) => side.push([k, clean(v)]),
    winIdx: 0,
    ...script,
  };
  // a function-valued `windows` is called with the call index
  if (typeof script.windows === 'function') {
    T.windowAt = script.windows;
    delete T.windows;
  }
  globalThis.__T = T;

  // fast timers, deterministic randomness, fresh caches
  globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms > 5 ? 1 : ms, ...a);
  const realRandom = Math.random; Math.random = lcg(12345);
  workflowCache.cache = {};
  voiceController.isFollowUpWindowActive = false;
  if (def.preload) { globalThis.__T = { ...T, side: () => {}, main: () => {} }; def.preload(workflowCache, uiMapStore); globalThis.__T = T; }

  const counts = {};
  const tools = def.tools ? def.tools(h) : {};
  const registered = new Set(def.registered || Object.keys(tools));

  const toolManager = {
    has: (n) => registered.has(n),
    list: () => [...registered],
    async execute(name, args, ...extra) {
      T.main('tool', [name, clean(args), extra.length > 0]);
      const fn = tools[name];
      if (!fn) return { success: false, data: null, error: `Tool not found: ${name}` };
      counts[name] = (counts[name] || 0) + 1;
      return await fn(args, counts[name] - 1);
    },
  };
  const planResponses = [...(def.planResponses || [])];
  const planner = {
    async createPlan(goal, entities, history, attempt, ctxStr, uiMap) {
      T.main('planner.createPlan', [goal, entities, history.length, attempt, ctxStr, Object.keys(uiMap || {}).length]);
      const r = planResponses.length ? planResponses.shift() : { steps: [] };
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const replies = [...(def.replies || [])];
  const aiProvider = {
    async generate(prompt, opts) {
      T.main('ai.generate', [prompt, opts]);
      return replies.length ? replies.shift() : 'All done.';
    },
    async embed() { return null; },
  };

  const loop = new AgentLoop(planner, toolManager, aiProvider, {});
  let outcome;
  try {
    const inputs = def.inputs || [def.input];
    const responses = [];
    for (const input of inputs) {
      if (def.drive) responses.push(await def.drive(loop, h, input));
      else responses.push(await loop.run(input, { ...(def.options || {}), signal: def.useSignal ? h.signal : undefined }));
    }
    outcome = { response: inputs.length === 1 ? responses[0] : responses };
  } catch (err) {
    outcome = { error: `${err.name}: ${err.message}` };
  }
  // let fire-and-forget work (fact extraction, queued background tasks) finish
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  await new Promise((r) => realSetTimeout(r, 20));

  globalThis.setTimeout = realSetTimeout;
  Math.random = realRandom;
  globalThis.__T = undefined;
  return { ...outcome, main, side: side.map((s) => JSON.stringify(s)).sort().map((s) => JSON.parse(s)) };
}

export function compareTraces(name, actual, golden) {
  assert.deepEqual(actual.response, golden.response, `${name}: response`);
  assert.deepEqual(actual.error, golden.error, `${name}: error`);
  assert.deepEqual(actual.main, golden.main, `${name}: main call sequence`);
  assert.deepEqual(actual.side, golden.side, `${name}: side effects`);
}
