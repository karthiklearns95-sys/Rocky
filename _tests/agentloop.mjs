/**
 * AgentLoop characterization tests: node _tests/agentloop.mjs   (UPDATE_GOLDEN=1 to re-record)
 *
 * Runs the real AgentLoop against scripted tools/planner/model and compares everything it does
 * with a recorded golden trace. These recordings were taken from the single-file AgentLoop BEFORE
 * it was split into modules, so a refactor must reproduce them exactly.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runScenario, compareTraces } from './harness/runner.mjs';
import { scenarios } from './agentloop.scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenPath = path.join(here, 'golden', 'agentloop.json');
const update = process.env.UPDATE_GOLDEN === '1';
const golden = fs.existsSync(goldenPath) ? JSON.parse(fs.readFileSync(goldenPath, 'utf8')) : {};
const only = process.env.ONLY;

const realLog = console.log, realWarn = console.warn, realError = console.error;
let passed = 0, failed = 0;
const recorded = {};

for (const def of scenarios) {
  if (only && !def.name.includes(only)) continue;
  console.log = console.warn = console.error = () => {};
  let trace, thrown;
  try { trace = await runScenario(def); } catch (e) { thrown = e; }
  console.log = realLog; console.warn = realWarn; console.error = realError;

  if (thrown) { console.error(`  ❌ ${def.name}\n     harness error: ${thrown.stack}`); failed++; continue; }
  recorded[def.name] = trace;
  if (update) { console.log(`  📝 ${def.name}  (${trace.main.length} calls${trace.error ? `, error: ${trace.error}` : ''})`); continue; }
  try {
    if (!golden[def.name]) throw new Error('no golden trace recorded (run with UPDATE_GOLDEN=1)');
    compareTraces(def.name, trace, golden[def.name]);
    console.log(`  ✅ ${def.name}`); passed++;
  } catch (e) {
    console.error(`  ❌ ${def.name}\n     ${String(e.message).split('\n').slice(0, 14).join('\n     ')}`); failed++;
  }
}

if (update) {
  const merged = only ? { ...golden, ...recorded } : recorded;
  fs.writeFileSync(goldenPath, JSON.stringify(merged, null, 1));
  console.log(`\nRecorded ${Object.keys(recorded).length} scenarios to _tests/golden/agentloop.json`);
  process.exit(0);
}
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
