// Run every Rocky test file and print one summary.   npm test     (or: node scripts/run_tests.mjs)
//   node scripts/run_tests.mjs voice browser      only the files whose names contain these words
// Each file runs in its own process; a file that hangs is stopped after 5 minutes.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, '_tests');
const NEEDS_HOOKS = new Set(['agentloop.mjs']);          // runs with the stand-ins for Windows/AI modules
const SKIP = new Set(['agentloop.scenarios.mjs']);         // data for agentloop.mjs, not a test

// Run the tests in the same runtime as the app: Electron's Node (compiled libraries such as SQLite are
// built for it). ROCKY_TEST_RUNTIME=node uses plain Node instead.
function pickRuntime() {
  if (process.env.ROCKY_TEST_RUNTIME !== 'node') {
    try {
      const require = createRequire(path.join(root, 'package.json'));
      const bin = require('electron');
      if (fs.existsSync(bin)) {
        return { bin, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, label: `Electron ${require('electron/package.json').version} (the app's runtime)` };
      }
    } catch { /* Electron not installed: plain Node */ }
  }
  return { bin: process.execPath, env: process.env, label: `Node ${process.version}` };
}
const runtime = pickRuntime();
console.log(`Running tests with ${runtime.label}\n`);

const only = process.argv.slice(2).map((s) => s.toLowerCase());
const files = fs.readdirSync(testsDir)
  .filter((f) => f.endsWith('.mjs') && !SKIP.has(f))
  .filter((f) => !only.length || only.some((o) => f.toLowerCase().includes(o)))
  .sort();

const rows = [];
let bad = 0;
for (const f of files) {
  const args = [...(NEEDS_HOOKS.has(f) ? ['--import', './_tests/harness/register.mjs'] : []), path.join('_tests', f)];
  process.stdout.write(`${f.padEnd(26)} `);
  const t0 = Date.now();
  const r = spawnSync(runtime.bin, args, { cwd: root, env: runtime.env, encoding: 'utf8', timeout: 5 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const summary = (out.match(/Results?:[^\n]*/g) || []).pop() || (/Skipped:[^\n]*/.exec(out) || [])[0] || '';
  const ok = r.status === 0 && !r.error;
  const hung = r.error?.code === 'ETIMEDOUT';
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${secs.padStart(5)}s  ${hung ? `DID NOT FINISH within 5 minutes${summary ? ` (last: ${summary})` : ''}` : summary || (r.error ? r.error.message : `exit ${r.status}`)}`);
  if (!ok) {
    bad++;
    // Show the failing tests (lines with a red cross) and a little context.
    const lines = out.split('\n');
    lines.forEach((l, i) => { if (l.includes('❌')) console.log(`      ${l.trim()}\n        ${(lines[i + 1] || '').trim()}`); });
    // Warnings often say WHY (a library that did not load, a missing program).
    [...new Set(lines.filter((l) => /⚠️|Error:|disabled/.test(l) && !l.includes('❌')).map((l) => l.trim()))].slice(0, 4).forEach((l) => console.log(`      ! ${l.slice(0, 300)}`));
    if (!lines.some((l) => l.includes('❌'))) console.log(out.trim().split('\n').slice(-8).map((l) => `      ${l}`).join('\n'));
  }
  rows.push({ f, ok });
}
console.log(`\n${files.length - bad} of ${files.length} test files passed.${bad ? ' Copy the FAIL lines above and send them to Claude.' : ''}`);
process.exit(bad ? 1 : 0);
