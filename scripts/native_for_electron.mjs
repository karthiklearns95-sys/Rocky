// Make the SQLite library (better-sqlite3) work inside Electron.   npm run native
// Runs automatically after `npm install`.
//
// better-sqlite3 is compiled code, and a build works in ONE runtime: `npm install` fetches the build
// for plain Node, but Rocky runs inside Electron, whose Node is different, so the knowledge graph
// would silently switch itself off. This downloads the ready-made Electron build (no compiler
// needed). The tests run inside Electron too (npm test), so they check exactly what the app uses.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const PROBE = "try{const D=require('better-sqlite3');new D(':memory:').exec('CREATE VIRTUAL TABLE t USING fts5(x)');console.log('OK')}catch(e){console.log('FAIL '+e.message.split('\\n').slice(0,2).join(' '))}";

function electronInfo() {
  try {
    const bin = require('electron');
    if (!fs.existsSync(bin)) return null;
    return { bin, version: require('electron/package.json').version };
  } catch { return null; }
}
const worksInElectron = (bin) => spawnSync(bin, ['-e', PROBE], { cwd: root, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).stdout?.trim() || 'FAIL no output';

const el = electronInfo();
if (!el) { console.log('[native] Electron is not installed yet; nothing to do.'); process.exit(0); }
const sqliteDir = path.dirname(require.resolve('better-sqlite3/package.json'));

if (worksInElectron(el.bin) === 'OK') { console.log(`[native] better-sqlite3 already works in Electron ${el.version}.`); process.exit(0); }

console.log(`[native] Fetching the better-sqlite3 build for Electron ${el.version}...`);
const prebuild = require.resolve('prebuild-install/bin.js');
const r = spawnSync(process.execPath, [prebuild, '--runtime', 'electron', '--target', el.version], { cwd: sqliteDir, stdio: 'inherit' });
const after = worksInElectron(el.bin);
if (r.status === 0 && after === 'OK') {
  console.log('[native] Done: the knowledge graph works inside Rocky.');
  process.exit(0);
}
// Never fail `npm install` over this; say clearly what is wrong and how to fix it.
console.warn(`[native] Could not get a working build (${after}).`);
console.warn('[native] Fix: npx @electron/rebuild -f -w better-sqlite3   (needs the Visual Studio C++ build tools), then npm run doctor');
process.exit(0);
