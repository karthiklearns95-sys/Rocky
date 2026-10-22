// Run every Rocky test file and print one summary.   npm test     (or: node scripts/run_tests.mjs)
//   node scripts/run_tests.mjs voice browser      only the files whose names contain these words
// Each file runs in its own process; a file that hangs is stopped after 5 minutes.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, '_tests');
const NEEDS_HOOKS = new Set(['agentloop.mjs']);          // runs with the stand-ins for Windows/AI modules
const SKIP = new Set(['agentloop.scenarios.mjs']);         // data for agentloop.mjs, not a test

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
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 5 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const summary = (out.match(/Results?:[^\n]*/g) || []).pop() || (/Skipped:[^\n]*/.exec(out) || [])[0] || '';
  const ok = r.status === 0 && !r.error;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${secs.padStart(5)}s  ${summary || (r.error ? r.error.message : `exit ${r.status}`)}`);
  if (!ok) {
    bad++;
    // Show the failing tests (lines with a red cross) and a little context.
    const lines = out.split('\n');
    lines.forEach((l, i) => { if (l.includes('❌')) console.log(`      ${l.trim()}\n        ${(lines[i + 1] || '').trim()}`); });
    if (!lines.some((l) => l.includes('❌'))) console.log(out.trim().split('\n').slice(-8).map((l) => `      ${l}`).join('\n'));
  }
  rows.push({ f, ok });
}
console.log(`\n${files.length - bad} of ${files.length} test files passed.${bad ? ' Copy the FAIL lines above and send them to Claude.' : ''}`);
process.exit(bad ? 1 : 0);
