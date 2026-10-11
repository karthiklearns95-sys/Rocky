// What changed between two golden files?   node _tests/harness/diffGoldens.mjs old.json new.json
import fs from 'fs';
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const short = (v) => JSON.stringify(v)?.slice(0, 230);
let changed = 0;
for (const name of Object.keys(b)) {
  const x = a[name], y = b[name];
  if (!x) { console.log(`\n+ ${name} (new scenario)`); continue; }
  const lines = [];
  if (JSON.stringify(x.response) !== JSON.stringify(y.response)) lines.push(`  response: ${short(x.response)}\n        -> ${short(y.response)}`);
  if (x.error !== y.error) lines.push(`  error: ${x.error}  ->  ${y.error}`);
  const n = Math.max(x.main.length, y.main.length);
  let shown = 0;
  for (let i = 0; i < n && shown < 6; i++) {
    if (JSON.stringify(x.main[i]) !== JSON.stringify(y.main[i])) {
      lines.push(`  main[${i}]: ${short(x.main[i])}\n       -> ${short(y.main[i])}`); shown++;
    }
  }
  const sx = x.side.map((s) => JSON.stringify(s)), sy = y.side.map((s) => JSON.stringify(s));
  for (const s of sx) if (!sy.includes(s)) lines.push(`  side removed: ${s.slice(0, 200)}`);
  for (const s of sy) if (!sx.includes(s)) lines.push(`  side added:   ${s.slice(0, 200)}`);
  if (lines.length) { changed++; console.log(`\n~ ${name}\n${lines.join('\n')}`); }
}
console.log(`\n${changed} scenario(s) changed`);
