/**
 * Browser downloads and uploads: node _tests/transfers.mjs
 * File-safety tests always run; the download/upload tests drive a REAL Chrome/Chromium (see browser.mjs).
 */
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { chromium } from 'playwright-core';
import { isSensitivePath, checkUploadable, resolveUserFile, rockyDataDir, defaultSearchRoots } from '../tools/browser/fileSafety.js';
import { isRiskyFile, formatBytes, DownloadTracker, safeFileName, uniqueName } from '../tools/browser/downloadTracker.js';
import { browserDownload, browserUpload } from '../tools/browser/transferController.js';
import { findBrowser, probeEndpoint } from '../tools/browser/chromeLauncher.js';
import { PlaywrightManager } from '../tools/browser/playwrightManager.js';
import { openURL, browserRead } from '../tools/browser/browserController.js';
import { sessionStore } from '../tools/browser/browserSessionStore.js';

/**
 * Delete a temp folder without failing the run. On Windows Chrome keeps its profile files locked for a
 * moment after it has been told to close, so wait for it to go away and retry the delete.
 */
async function removeQuietly(dir, port = null) {
  if (port) {
    for (let i = 0; i < 40 && (await probeEndpoint(port, { timeoutMs: 300 })).ok; i++) await new Promise((r) => setTimeout(r, 250));
  }
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }
  catch (e) { console.log(`     (could not delete the temp folder ${dir}: ${e.code}; Windows will clean it up later)`); }
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 4).join('\n     ')}`); failed++; }
}
const mk = (p, content = 'data') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };

console.log('\nWhich files may leave this computer');
await test('keys, secrets, browser profiles, password exports and Rocky\'s own memory are off limits', () => {
  for (const p of ['C:\\Users\\g\\.ssh\\id_rsa', '/home/g/.aws/credentials', 'C:\\Users\\g\\project\\.env', '/x/.env.production', 'C:\\Users\\g\\server.pem',
    'C:\\Users\\g\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data', 'C:\\Users\\g\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\a\\logins.json',
    '/home/g/Documents/passwords.csv', '/home/g/vault.kdbx', 'C:\\Windows\\System32\\config\\SAM']) assert.equal(isSensitivePath(p), true, p);
  assert.equal(isSensitivePath('/r/data/knowledge_graph.db', { protectedDirs: ['/r/data'] }), true);
  assert.equal(isSensitivePath('/r/data', { protectedDirs: ['/r/data'] }), true);
  for (const p of ['C:\\Users\\g\\Documents\\Resume.pdf', '/home/g/Desktop/photo.jpg', '/home/g/notes/environment.md', '/home/g/Documents/password policy.pdf', '/r/database/x.db']) {
    assert.equal(isSensitivePath(p, { protectedDirs: ['/r/data'] }), false, p);
  }
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-xfer-'));
await test('uploadable: a normal file passes; folders, empty, huge, missing and secrets are refused', () => {
  const ok = mk(path.join(tmp, 'Documents', 'passport-copy.pdf'), 'pdf!');
  assert.equal(checkUploadable(ok).ok, true);
  assert.match(checkUploadable(path.join(tmp, 'Documents')).error, /folder/);
  assert.match(checkUploadable(mk(path.join(tmp, 'empty.txt'), '')).error, /empty/);
  assert.match(checkUploadable(ok, { maxBytes: 2 }).error, /limit/);
  assert.match(checkUploadable(path.join(tmp, 'nope.txt')).error, /does not exist/);
  assert.match(checkUploadable(mk(path.join(tmp, '.ssh', 'id_rsa'), 'KEY')).error, /private key/);
  assert.match(checkUploadable(mk(path.join(rockyDataDir(), '__test_secret.txt'), 'x')).error, /Rocky's own memory/);
  fs.rmSync(path.join(rockyDataDir(), '__test_secret.txt'));
});
await test('a symlink cannot smuggle a secret out', () => {
  const secret = mk(path.join(tmp, '.ssh', 'id_ed25519'), 'KEY');
  const link = path.join(tmp, 'Documents', 'holiday.jpg');
  try { fs.symlinkSync(secret, link); } catch (e) {
    if (e.code === 'EPERM') { console.log('     (Windows only lets admins or Developer Mode create symlinks: nothing to check here)'); return; }
    throw e;
  }
  assert.match(checkUploadable(link).error, /private key/);
});
const roots = [path.join(tmp, 'Documents'), path.join(tmp, 'Downloads')];
mk(path.join(tmp, 'Documents', 'Resume.pdf')); mk(path.join(tmp, 'Documents', 'Resume - old.pdf')); mk(path.join(tmp, 'Downloads', 'invoice march.pdf'));
mk(path.join(tmp, 'Documents', 'sub', 'deep', 'toodeep', 'hidden.txt')); mk(path.join(tmp, 'Documents', '.private', 'x.txt'));
mk(path.join(tmp, 'Documents', 'Tax Return 2024.pdf')); mk(path.join(tmp, 'Documents', 'Tax Return 2025.pdf'));
await test('a spoken name becomes a file: exact beats partial; "my" and extensions are optional', () => {
  assert.equal(path.basename(resolveUserFile('my resume', { roots }).file), 'Resume.pdf');
  assert.equal(path.basename(resolveUserFile('Resume.pdf', { roots }).file), 'Resume.pdf');
  assert.equal(path.basename(resolveUserFile('invoice march', { roots }).file), 'invoice march.pdf');
  assert.equal(path.basename(resolveUserFile('invoice', { roots }).file), 'invoice march.pdf');
});
await test('an exact path is used as given; ~ means the home folder', () => {
  const p = path.join(tmp, 'Downloads', 'invoice march.pdf');
  assert.equal(resolveUserFile(p, { roots: [] }).file, p);
  assert.equal(resolveUserFile('~/Downloads/invoice march.pdf', { roots: [], home: tmp }).file, p);
  assert.match(resolveUserFile(path.join(tmp, 'zzz.pdf'), { roots }).error, /no file at/);
});
await test('several equally good matches: Rocky asks instead of choosing what leaves the computer', () => {
  const r = resolveUserFile('tax return', { roots });
  assert.match(r.error, /More than one file/);
  assert.equal(r.candidates.length, 2);
});
await test('not found, too deep and hidden folders are not searched', () => {
  assert.match(resolveUserFile('hidden', { roots }).error, /cannot find/);
    assert.match(resolveUserFile('', { roots }).error, /Which file/);
  assert.match(resolveUserFile('x', { roots }).error, /more of the file name/);
});
await test('download names: no path parts, no illegal characters, no device names, never overwrites', () => {
  assert.equal(safeFileName('..\\..\\Windows\\evil.dll'), 'evil.dll');
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('a<b>c:d"e|f?g*.txt'), 'a_b_c_d_e_f_g_.txt');
  assert.equal(safeFileName('CON.txt'), '_CON.txt'); assert.equal(safeFileName('nul'), '_nul');
  assert.equal(safeFileName('  ...  '), 'download'); assert.equal(safeFileName('file. '), 'file'); assert.equal(safeFileName('.hidden'), 'hidden');
  assert.ok(safeFileName('x'.repeat(400) + '.pdf').length <= 150 && safeFileName('x'.repeat(400) + '.pdf').endsWith('.pdf'));
  const have = new Set(['/d/a.txt', '/d/a (1).txt']);
  assert.equal(uniqueName('/d', 'a.txt', (p) => have.has(p.replace(/\\/g, '/'))), 'a (2).txt');
  assert.equal(uniqueName('/d', 'b.txt', (p) => have.has(p.replace(/\\/g, '/'))), 'b.txt');
});
await test('risky file types are flagged; sizes read well', () => {
  for (const n of ['setup.exe', 'a.MSI', 'run.ps1', 'x.bat', 'macro.js', 'a.lnk']) assert.equal(isRiskyFile(n), true, n);
  for (const n of ['report.pdf', 'photo.jpg', 'a.txt', 'archive.zip']) assert.equal(isRiskyFile(n), false, n);
  assert.deepEqual([formatBytes(0), formatBytes(900), formatBytes(5000), formatBytes(5 * 1048576), formatBytes(2.5 * 1073741824)], ['0 B', '900 B', '4.9 KB', '5.0 MB', '2.5 GB']);
});

// ── Real browser ───────────────────────────────────────────────────────────
const chromePath = process.env.ROCKY_TEST_CHROME
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p))
  || (() => { try { return findBrowser(); } catch { return null; } })();

if (!chromePath) {
  console.log('\n(skipping real-browser checks: no Chrome/Chromium found; set ROCKY_TEST_CHROME)');
} else {
  console.log(`\nReal browser (${path.basename(chromePath)})`);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const html = (b, t = 'Page') => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>${t}</title>${b}`); };
    const attach = (name, body) => { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"`, 'content-length': body.length }); res.end(body); };
    switch (u.pathname) {
      case '/dl': return html('<a href="/report.pdf">Download report</a> <a href="/setup.exe">Get installer</a> <a href="/slow.bin">Slow file</a> <a href="/about">About us</a> <button>Does nothing</button> <a href="/missing.zip" download>Broken file</a>', 'Downloads');
      case '/report.pdf': return attach('report.pdf', Buffer.alloc(5000, 7));
      case '/setup.exe': return attach('setup.exe', Buffer.alloc(300, 1));
      case '/slow.bin': {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="slow.bin"', 'content-length': 3000 });
        let n = 0; const t = setInterval(() => { res.write(Buffer.alloc(1000, 2)); if (++n === 3) { clearInterval(t); res.end(); } }, 1000); return;
      }
      case '/about': return html('<h1>About</h1>', 'About');
      case '/up1': return html('<label>Resume <input type="file" id="f"></label>', 'Upload one');
      case '/up2': return html('<input type="file" id="f" hidden><button onclick="document.getElementById(\'f\').click()">Attach file</button>', 'Upload hidden');
      case '/up3': return html('<input type="file" id="a" aria-label="Photo"><input type="file" id="b" aria-label="Passport scan">', 'Upload two');
      case '/up4': return html('<input type="file" id="f" multiple aria-label="Documents">', 'Upload many');
      case '/none': return html('<p>nothing here</p>', 'None');
      default: res.statusCode = 404; return res.end('nope');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-prof-'));
  const dlDir = path.join(tmp, 'saved');
  const port = 9300 + Math.floor(Math.random() * 500);
  const mgr = new PlaywrightManager({
    store: sessionStore, userDataDir: profile, extraArgs: ['--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-gpu'],
    settings: { debugPort: port, executable: chromePath, startTimeoutMs: 20000 },
    downloads: new DownloadTracker({ dir: dlDir }),
  });
  const pageFiles = async (sel = '#f') => (await mgr.getActivePage()).evaluate((s) => [...document.querySelector(s).files].map((f) => `${f.name}:${f.size}`), sel);

  console.log('  — downloads');
  await test('clicking a download link: waits for it and reports the saved file', async () => {
    await openURL({ url: base + '/dl' }, mgr);
    const r = await browserDownload({ query: 'Download report' }, mgr);
    assert.equal(r.success, true, r.error);
    assert.equal(path.dirname(r.path), dlDir);
    assert.equal(fs.statSync(r.path).size, 5000);
    assert.match(r.data, /report\.pdf.*4\.9 KB/);
  });
  await test('the same name again is saved as "report (1).pdf" and that is the path reported', async () => {
    const r = await browserDownload({ query: 'Download report' }, mgr);
    assert.equal(r.success, true, r.error);
    assert.equal(path.basename(r.path), 'report (1).pdf');
    assert.equal(fs.existsSync(r.path), true);
  });
  await test('a program file downloads but comes with a warning, and is never opened', async () => {
    const r = await browserDownload({ query: 'Get installer' }, mgr);
    assert.equal(r.success, true, r.error);
    assert.match(r.data, /can run code.*not opened/);
  });
  await test('a download by address; an address that is a web page is explained, not mistaken for a download', async () => {
    const r = await browserDownload({ url: base + '/report.pdf' }, mgr);
    assert.equal(r.success, true, r.error);
    assert.match(path.basename(r.path), /^report \(2\)\.pdf$/);
    const page = await browserDownload({ url: base + '/about', timeoutSec: 1 }, mgr);
    assert.equal(page.success, false);
    assert.match(page.error, /opened a page, not a download/);
    assert.equal((await browserDownload({ url: 'javascript:alert(1)' }, mgr)).success, false);
  });
  await test('a click that downloads nothing is reported, and so is a control that is not there', async () => {
    await openURL({ url: base + '/dl' }, mgr);
    const r = await browserDownload({ query: 'About us' }, mgr);
    assert.equal(r.success, false);
    assert.match(r.error, /did not start a download/);
    const none = await browserDownload({ query: 'Get the secret documents' }, mgr);
    assert.match(none.error, /Could not find/);
    assert.match((await browserDownload({}, mgr)).error, /what to download/);
  });
  await test('a slow download: "still downloading" if it takes longer than asked, then it finishes by itself', async () => {
    await openURL({ url: base + '/dl' }, mgr);
    const r = await browserDownload({ query: 'Slow file', timeoutSec: 1 }, mgr);
    assert.equal(r.success, false);
    assert.match(r.error, /still downloading/);
    await new Promise((res) => setTimeout(res, 3000));
    const list = await browserDownload({ action: 'list' }, mgr);
    assert.match(list.data, /✓ slow\.bin \(2\.9 KB\)/);
    assert.equal(fs.statSync(path.join(dlDir, 'slow.bin')).size, 3000);
  });
  await test('waiting for a slow download to the end works too', async () => {
    const r = await browserDownload({ query: 'Slow file', timeoutSec: 20 }, mgr);
    assert.equal(r.success, true, r.error);
    assert.equal(path.basename(r.path), 'slow (1).bin');
  });
  await test('a download that fails on the server is reported as cancelled', async () => {
    await openURL({ url: base + '/dl' }, mgr);
    const r = await browserDownload({ query: 'Broken file', timeoutSec: 5 }, mgr);
    assert.equal(r.success, false);
  });

  console.log('  — uploads');
  const doc = mk(path.join(tmp, 'Documents', 'cv.pdf'), 'cv-bytes');
  const doc2 = mk(path.join(tmp, 'Documents', 'cover letter.txt'), 'hello');
  const upRoots = [path.join(tmp, 'Documents')];
  await test('a visible file input found by its label: the file is attached (and the page really has it)', async () => {
    await openURL({ url: base + '/up1' }, mgr);
    const r = await browserUpload({ query: 'Resume', path: doc }, mgr, { roots: upRoots });
    assert.equal(r.success, true, r.error);
    assert.match(r.data, /Attached "cv\.pdf".*not sent yet/);
    assert.deepEqual(await pageFiles(), ['cv.pdf:8']);
  });
  await test('a spoken name is resolved to the file ("my cv")', async () => {
    await openURL({ url: base + '/up1' }, mgr);
    const r = await browserUpload({ query: 'Resume', path: 'my cv' }, mgr, { roots: upRoots });
    assert.equal(r.success, true, r.error);
    assert.deepEqual(await pageFiles(), ['cv.pdf:8']);
  });
  await test('a styled button that opens the file dialog: the dialog is intercepted and the file attached', async () => {
    await openURL({ url: base + '/up2' }, mgr);
    const r = await browserUpload({ query: 'Attach file', path: doc }, mgr, { roots: upRoots });
    assert.equal(r.success, true, r.error);
    assert.deepEqual(await pageFiles(), ['cv.pdf:8']);
  });
  await test('no control named: the page\'s only file input (even hidden) is used', async () => {
    await openURL({ url: base + '/up2' }, mgr);
    const r = await browserUpload({ path: doc }, mgr, { roots: upRoots });
    assert.equal(r.success, true, r.error);
    assert.deepEqual(await pageFiles(), ['cv.pdf:8']);
  });
  await test('two upload controls and no clear name: Rocky asks; with a name it picks the right one', async () => {
    await openURL({ url: base + '/up3' }, mgr);
    const amb = await browserUpload({ path: doc }, mgr, { roots: upRoots });
    assert.equal(amb.success, false);
    assert.match(amb.error, /2 upload controls/);
    assert.deepEqual(await pageFiles('#a'), []); assert.deepEqual(await pageFiles('#b'), []);
    const r = await browserUpload({ query: 'Passport scan', path: doc }, mgr, { roots: upRoots });
    assert.equal(r.success, true, r.error);
    assert.deepEqual(await pageFiles('#b'), ['cv.pdf:8']);
    assert.deepEqual(await pageFiles('#a'), []);
  });
  await test('several files: only where the control allows many', async () => {
    await openURL({ url: base + '/up1' }, mgr);
    const one = await browserUpload({ query: 'Resume', files: [doc, doc2] }, mgr, { roots: upRoots });
    assert.equal(one.success, false);
    assert.match(one.error, /only one file/);
    assert.deepEqual(await pageFiles(), []);
    await openURL({ url: base + '/up4' }, mgr);
    const many = await browserUpload({ query: 'Documents', files: [doc, doc2] }, mgr, { roots: upRoots });
    assert.equal(many.success, true, many.error);
    assert.deepEqual(await pageFiles(), ['cv.pdf:8', 'cover letter.txt:5']);
  });
  await test('secrets are never attached, and one bad file in a list stops the whole upload', async () => {
    await openURL({ url: base + '/up4' }, mgr);
    const key = mk(path.join(tmp, '.ssh', 'id_rsa'), 'KEY');
    const r = await browserUpload({ query: 'Documents', path: key }, mgr, { roots: upRoots });
    assert.equal(r.success, false);
    assert.match(r.error, /will not upload/);
    const mixed = await browserUpload({ query: 'Documents', files: [doc, key] }, mgr, { roots: upRoots });
    assert.equal(mixed.success, false);
    assert.deepEqual(await pageFiles(), [], 'nothing was attached');
  });
  await test('missing file, ambiguous name, no file given and a page without an upload control', async () => {
    await openURL({ url: base + '/up1' }, mgr);
    assert.match((await browserUpload({ query: 'Resume', path: 'zzz nothing' }, mgr, { roots: upRoots })).error, /cannot find/);
    mk(path.join(tmp, 'Documents', 'cv.docx'));
    assert.match((await browserUpload({ query: 'Resume', path: 'cv' }, mgr, { roots: upRoots })).error, /More than one file/);
    assert.match((await browserUpload({ query: 'Resume' }, mgr)).error, /Which file/);
    await openURL({ url: base + '/none' }, mgr);
    assert.match((await browserUpload({ path: doc }, mgr, { roots: upRoots })).error, /no upload control/);
  });

  try {
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await (await b.newBrowserCDPSession()).send('Browser.close').catch(() => {});
  } catch { /* already closed */ }
  server.close();
  await removeQuietly(profile, port);
  void probeEndpoint; void browserRead;
}
await removeQuietly(tmp);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
