// What does Rocky see on this PC?  Windows:  node scripts/list_apps.mjs ["spotify" "vs code" ...]
//
// With no arguments: scans the Start menu and prints every app Rocky can open.
// With names: shows what Rocky would open for each, why, and whether it is a close call.

import { appCatalog } from '../resolver/installedApps.js';
import resolveResource from '../resolver/resourceResolver.js';

if (process.platform !== 'win32') {
  console.log('This reads the Windows Start menu, so it only runs on Windows.');
  process.exit(0);
}

const log = console.log;
console.log = () => {};
appCatalog.storePath = null;                 // do not touch the real cache
appCatalog.init();
const n = await appCatalog.refresh();
console.log = log;

if (!n) {
  log('Could not read the installed apps (Get-StartApps failed). Rocky will fall back to its built-in list.');
  process.exit(1);
}
log(`Rocky can see ${appCatalog.size} installed apps.\n`);

const queries = process.argv.slice(2);
if (queries.length === 0) {
  for (const e of [...appCatalog.entries].sort((a, b) => a.name.localeCompare(b.name))) {
    log(`${e.name.padEnd(42)} ${e.kind.padEnd(6)} ${e.exe || ''}`);
  }
} else {
  console.log = () => {};
  const rows = [];
  for (const q of queries) rows.push([q, await resolveResource(q, {}), appCatalog.lookup(q)]);
  console.log = log;
  for (const [q, r, l] of rows) {
    const what = r.type === 'unknown' ? `NOT FOUND (${r.reason || 'unknown'})` : `${r.displayName || r.target}  [${r.type}, ${r.source}${r.matchedBy ? `: ${r.matchedBy}` : ''}, ${Math.round(r.confidence * 100)}%]`;
    log(`"${q}" -> ${what}`);
    if (l.ambiguous) log(`    close call with: ${l.matches.slice(1).map((m) => m.entry.name).join(', ')} (Rocky would ask)`);
  }
}
