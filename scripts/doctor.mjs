// Is everything Rocky needs in place on this computer?   npm run doctor
// Prints one line per check (OK / PROBLEM / note) and what to do about each problem.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import config from '../config/app.config.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
let problems = 0;
const ok = (what, detail = '') => console.log(`  OK       ${what}${detail ? `  (${detail})` : ''}`);
const bad = (what, detail, fix) => { problems++; console.log(`  PROBLEM  ${what}: ${detail}${fix ? `\n           fix: ${fix}` : ''}`); };
const note = (what, detail) => console.log(`  note     ${what}: ${detail}`);

// The same probe runs under plain Node and under Electron's Node (the app runs in Electron).
const SQLITE_PROBE = "try{const D=require('better-sqlite3');const d=new D(':memory:');d.exec('CREATE VIRTUAL TABLE t USING fts5(x)');console.log('OK')}catch(e){console.log('FAIL '+String(e.message).split('\\n').slice(0,2).join(' '))}";

console.log('\nRuntime');
const [maj] = process.versions.node.split('.').map(Number);
if (maj >= 20) ok('Node', process.version); else bad('Node', `${process.version} is too old`, 'install Node 20 or newer');
note('Platform', `${process.platform} ${os.release()} ${process.arch}`);

console.log('\nNative libraries');
const inNode = spawnSync(process.execPath, ['-e', SQLITE_PROBE], { cwd: root, encoding: 'utf8' }).stdout.trim();
let electronPath = null;
try { electronPath = require('electron'); if (!fs.existsSync(electronPath)) electronPath = null; } catch { /* not installed */ }
const inElectron = electronPath
  ? spawnSync(electronPath, ['-e', SQLITE_PROBE], { cwd: root, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).stdout.trim()
  : null;
if (inNode === 'OK') ok('SQLite (better-sqlite3) under Node'); else note('SQLite (better-sqlite3) under Node', inNode.replace(/^FAIL /, ''));
if (inElectron === null) bad('Electron', 'not installed', 'npm install');
else if (inElectron === 'OK') ok('SQLite (better-sqlite3) inside Electron (what the app uses)');
else bad('SQLite (better-sqlite3) inside Electron: the knowledge graph is OFF in the app', inElectron.replace(/^FAIL /, ''),
  'npm run native');
if (inNode !== 'OK' && inElectron === 'OK') note('SQLite', 'built for Electron, which is right for the app. npm test runs the tests with Electron\'s runtime, so this is fine.');
try { await import('@lancedb/lancedb'); ok('Vector database (LanceDB)'); } catch (e) { bad('Vector database (LanceDB)', e.message.split('\n')[0], 'npm install'); }

console.log('\nOllama (local AI)');
try {
  const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
  const names = ((await res.json()).models || []).map((m) => m.name);
  ok('Ollama is running', `${names.length} models`);
  for (const [role, model] of [['brain', config.models.brain], ['embedding', config.models.embedding]]) {
    const has = names.some((n) => n === model || n.startsWith(`${model}:`) || n.split(':')[0] === model.split(':')[0] && model.includes(':') === false);
    if (has) ok(`${role} model ${model}`); else bad(`${role} model ${model}`, 'not installed', `ollama pull ${model}`);
  }
} catch (e) {
  bad('Ollama', `not reachable on localhost:11434 (${e.message})`, 'start the Ollama app, then run npm run doctor again');
}

console.log('\nVoice');
const cache = config.stt.cacheDir || path.join(os.homedir(), '.rocky', 'models');
const modelDir = path.join(cache, ...config.stt.model.split('/'));
if (fs.existsSync(modelDir)) ok(`Speech model ${config.stt.model}`); else bad(`Speech model ${config.stt.model}`, `not downloaded (looked in ${modelDir})`, 'npm run models');
const piper = path.join(root, 'bin', 'piper', 'piper.exe'), voice = path.join(root, 'bin', 'piper', 'en_US-lessac-medium.onnx');
if (fs.existsSync(piper) && fs.existsSync(voice)) ok('Piper voice'); else bad('Piper voice', 'bin\\piper\\piper.exe or the voice model is missing', 'powershell -ExecutionPolicy Bypass -File scripts\\install_piper.ps1');

console.log('\nBrowser');
try {
  const { findBrowser } = await import('../tools/browser/chromeLauncher.js');
  ok('Chrome/Edge', findBrowser({ override: config.browser.executable }));
} catch (e) { bad('Chrome/Edge', e.message, 'install Chrome, or set ROCKY_BROWSER_PATH'); }

if (process.platform === 'win32') {
  console.log('\nWindows automation');
  const { tryWorker } = await import('../automation/system/psWorker.js');
  const ping = await tryWorker('ping', {}, { timeoutMs: 20000 });
  if (!ping.ok) bad('PowerShell worker', ping.error || 'no answer', 'send this output to Claude');
  else {
    ok('PowerShell worker', `PowerShell ${ping.result.ps}`);
    if (ping.result.dpi === 'per-monitor-v2') ok('DPI awareness', ping.result.dpi);
    else bad('DPI awareness', ping.result.dpi, 'send this output to Claude');
    const d = await tryWorker('displays');
    if (d.ok) ok('Monitors', d.result.map((m) => `${m.width}x${m.height}${m.primary ? ' primary' : ''}`).join(', '));
    const apps = await tryWorker('apps', {}, { timeoutMs: 20000 });
    if (apps.ok && apps.result?.length) ok('Start-menu apps', `${apps.result.length} found`); else bad('Start-menu apps', apps.error || 'none found', 'send this output to Claude');
  }
}

console.log(problems ? `\n${problems} problem(s). Fix them (the "fix:" lines), or send this whole output to Claude.` : '\nEverything Rocky needs is in place.');
process.exit(problems ? 1 : 0);
