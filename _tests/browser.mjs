/**
 * Browser over DevTools: node _tests/browser.mjs
 * Unit tests always run. The end-to-end part drives a REAL Chrome/Chromium through the same code
 * Rocky uses; it runs when a browser is found (set ROCKY_TEST_CHROME to point at one).
 */
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { chromium } from 'playwright-core';
import { browserCandidates, buildLaunchArgs, ensureBrowser, findBrowser, probeEndpoint } from '../tools/browser/chromeLauncher.js';
import { normalizeUrl, pickTab, openURL, browserClick, browserType, browserRead, browserTabs } from '../tools/browser/browserController.js';
import { parseQuery, DomResolver } from '../tools/browser/domResolver.js';
import { browserMedia, parseTime, parseVolume, pickMedia } from '../tools/browser/mediaController.js';
import { PlaywrightManager } from '../tools/browser/playwrightManager.js';
import { sessionStore } from '../tools/browser/browserSessionStore.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.stack?.split('\n').slice(0, 4).join('\n     ')}`); failed++; }
}

console.log('\nFinding and starting the browser');
await test('Windows candidates cover Chrome and Edge in Program Files and the per-user folder; override wins', () => {
  const c = browserCandidates({ platform: 'win32', env: { PROGRAMFILES: 'C:\\PF', LOCALAPPDATA: 'C:\\Users\\g\\AppData\\Local' } });
  assert.ok(c.includes('C:\\PF\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(c.includes('C:\\Users\\g\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(c.some((p) => p.endsWith('msedge.exe')));
  assert.deepEqual(browserCandidates({ override: 'D:\\mine.exe' }), ['D:\\mine.exe']);
});
await test('no browser installed gives a clear error', () => {
  assert.throws(() => findBrowser({ exists: () => false, platform: 'win32', env: {} }), /No Chrome or Edge found/);
});
await test('launch arguments: debugging port bound to localhost, own profile', () => {
  const a = buildLaunchArgs({ port: 9222, userDataDir: 'D:\\p' });
  assert.ok(a.includes('--remote-debugging-port=9222'));
  assert.ok(a.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(a.includes('--user-data-dir=D:\\p'));
});
const fakeChild = () => ({ once() {}, unref() {} });
await test('already running: attaches without starting another', async () => {
  let spawned = 0;
  const r = await ensureBrowser({ port: 1, userDataDir: 'x', probe: async () => ({ ok: true, browser: 'Chrome/1' }), spawn: () => { spawned++; return fakeChild(); } });
  assert.deepEqual([r.launched, spawned, r.endpoint], [false, 0, 'http://127.0.0.1:1']);
});
await test('not running: starts it detached and waits for the port', async () => {
  let t = 0, probes = 0, call;
  const r = await ensureBrowser({
    port: 7, userDataDir: 'x', executable: 'chrome.exe', mkdir: () => {},
    probe: async () => ({ ok: ++probes >= 4 }), spawn: (...a) => { call = a; return fakeChild(); },
    sleepFn: async (ms) => { t += ms; }, now: () => t,
  });
  assert.equal(r.launched, true);
  assert.equal(call[0], 'chrome.exe');
  assert.equal(call[2].detached, true);
});
await test('a browser that never opens the port gives an actionable error', async () => {
  let t = 0;
  await assert.rejects(ensureBrowser({
    port: 7, userDataDir: 'x', executable: 'c', mkdir: () => {}, probe: async () => ({ ok: false }), spawn: fakeChild,
    sleepFn: async (ms) => { t += ms; }, now: () => t, startTimeoutMs: 3000,
  }), /already open, close it/);
});
await test('a browser that cannot be started reports why', async () => {
  let t = 0;
  const child = { once(ev, fn) { if (ev === 'error') this.fail = fn; }, unref() {} };
  await assert.rejects(ensureBrowser({
    port: 7, userDataDir: 'x', executable: 'nope.exe', mkdir: () => {}, probe: async () => ({ ok: false }),
    spawn: () => { process.nextTick(() => child.fail(new Error('ENOENT'))); return child; },
    sleepFn: async (ms) => { t += ms; await new Promise((r) => setTimeout(r, 5)); }, now: () => t, startTimeoutMs: 5000,
  }), /Could not start the browser \(nope.exe\): ENOENT/);
});
await test('probe: dead port is not ok', async () => {
  assert.equal((await probeEndpoint(1, { timeoutMs: 300 })).ok, false);
});

console.log('\nAddresses, words and tabs');
await test('only web addresses are opened; scheme is added; the path keeps its case', () => {
  assert.equal(normalizeUrl('youtube.com'), 'https://youtube.com/');
  assert.equal(normalizeUrl('https://Example.com/Some/Path?Q=A'), 'https://example.com/Some/Path?Q=A');
  for (const bad of ['javascript:alert(1)', 'file:///c:/secret', 'chrome://settings', 'youtube cats', '', null]) assert.equal(normalizeUrl(bad), null, String(bad));
});
await test('"search bar" means a text box named search; "play button" a button named play', () => {
  assert.deepEqual(parseQuery('Search bar'), { raw: 'Search bar', name: 'search', kinds: ['textbox'] });
  assert.deepEqual(parseQuery('the Play button'), { raw: 'the Play button', name: 'play', kinds: ['button'] });
  assert.equal(parseQuery('c++ docs').name, 'c++ docs');
});
await test('tabs are picked by number or by the words in the title/address', () => {
  const tabs = [{ index: 0, title: 'Inbox - Mail', url: 'https://mail.example.com' }, { index: 1, title: 'Cats on YouTube', url: 'https://youtube.com/watch' }];
  assert.equal(pickTab(tabs, { index: 1 }).index, 1);
  assert.equal(pickTab(tabs, { query: 'youtube cats' }).index, 1);
  assert.equal(pickTab(tabs, { query: 'mail' }).index, 0);
  assert.equal(pickTab(tabs, { query: 'spreadsheet' }), null);
  assert.equal(pickTab(tabs, { index: 9 }), null);
});

console.log('\nMedia words');
await test('times: 1:30, 90, 1h2m3s, 45 sec; junk is refused', () => {
  assert.equal(parseTime('1:30'), 90); assert.equal(parseTime('1:02:03'), 3723); assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('2 minutes'), 120); assert.equal(parseTime('1h2m3s'), 3723); assert.equal(parseTime('45 sec'), 45); assert.equal(parseTime(30), 30);
  assert.equal(parseTime('soon'), null); assert.equal(parseTime(''), null);
});
await test('volume: 30, 30%, 0.3 all mean 30 %; 100+ is capped; junk is refused', () => {
  assert.equal(parseVolume('30'), 0.3); assert.equal(parseVolume('30%'), 0.3); assert.equal(parseVolume(0.3), 0.3);
  assert.equal(parseVolume(250), 1); assert.equal(parseVolume('loud'), null); assert.equal(parseVolume(-5), null);
});
await test('the media to control: playing beats paused, a picture beats audio', () => {
  const a = { tag: 'audio', paused: true, area: 0, duration: 200 }, v = { tag: 'video', paused: true, area: 5000, duration: 100 };
  assert.equal(pickMedia([a, v]), v);
  assert.equal(pickMedia([v, { ...a, paused: false }]).tag, 'audio');
  assert.equal(pickMedia([]), null);
});

// ── End to end with a real browser ─────────────────────────────────────────
const chromePath = process.env.ROCKY_TEST_CHROME
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p))
  || (() => { try { return findBrowser(); } catch { return null; } })();

if (!chromePath) {
  console.log('\n(skipping real-browser checks: no Chrome/Chromium found; set ROCKY_TEST_CHROME)');
} else {
  console.log(`\nReal browser (${path.basename(chromePath)})`);
  const PAGE = `<!doctype html><title>Fixture Home</title><body>
    <input aria-label="Search" type="text"><button onclick="location='/results?q='+document.querySelector('input').value">Search</button>
    <a href="/video/1">Cool video one</a>
    <a href="/popup" target="_blank">Open popup page</a>
    <button id="like">Like</button>
    <button id="play" onclick="this.textContent='Pause'">Play</button>
    <p>Subscribe now for more</p>
    <input placeholder="Email address">
    <button>C++ docs</button></body>`;

  // 30 s of 8 kHz 8-bit silence: a real media file the browser can play and seek in.
  const wav = (() => {
    const n = 8000 * 30, b = Buffer.alloc(44 + n, 128);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
    b.write('data', 36); b.writeUInt32LE(n, 40); return b;
  })();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/a.wav') {                       // with Range support, which seeking needs
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (m) {
        const start = +m[1], end = m[2] ? +m[2] : wav.length - 1;
        res.writeHead(206, { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${wav.length}`, 'content-length': end - start + 1 });
        return res.end(wav.subarray(start, end + 1));
      }
      res.writeHead(200, { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': wav.length });
      return res.end(wav);
    }
    if (u.pathname === '/player') {
      res.setHeader('content-type', 'text/html');
      return res.end('<!doctype html><title>Player Page</title><audio id="a" src="/a.wav" controls preload="auto"></audio><button id="play" onclick="document.getElementById(\'a\').play()">Play</button><button>Next</button>');
    }
    const page = u.pathname === '/' ? PAGE : `<!doctype html><title>${u.pathname}${u.search}</title><h1>${u.pathname}</h1><button>Back</button>`;
    res.setHeader('content-type', 'text/html'); res.end(page);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rocky-prof-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const mk = () => new PlaywrightManager({
    store: sessionStore, userDataDir: profile, extraArgs: ['--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-gpu'],
    settings: { debugPort: port, executable: chromePath, startTimeoutMs: 20000 },
  });
  const mgr = mk();

  await test('Rocky starts his browser and attaches over DevTools', async () => {
    await mgr.getContext();
    assert.equal((await probeEndpoint(port)).ok, true);
    assert.equal(sessionStore.hasActiveContext(), true);
  });
  await test('two tools asking at once share one connection', async () => {
    const [a, b] = await Promise.all([mgr.getContext(), mgr.getContext()]);
    assert.equal(a, b);
  });
  await test('openURL goes to the page, keeps path case; javascript: is refused', async () => {
    const r = await openURL({ url: base + '/' }, mgr);
    assert.equal(r.success, true, r.error);
    assert.match(r.data, /Fixture Home/);
    const bad = await openURL({ url: 'javascript:alert(1)' }, mgr);
    assert.equal(bad.success, false);
  });
  await test('browserRead shows title, address and the controls on the page', async () => {
    const r = await browserRead({}, mgr);
    assert.equal(r.success, true);
    assert.match(r.data, /Fixture Home/);
    assert.match(r.data, /button "Search"/);
    assert.match(r.data, /link "Cool video one"/);
  });
  await test('"search bar" finds the search box; typing + Enter searches (page changes)', async () => {
    const r = await browserType({ query: 'search bar', text: 'cats', pressEnter: false }, mgr);
    assert.equal(r.success, true, r.error);
    const go = await browserClick({ query: 'Search button' }, mgr);
    assert.equal(go.success, true, go.error);
    assert.equal(go.verdict, 'changed');
    assert.match(go.data, /results\?q=cats/);
  });
  await test('Enter in a field submits via the page and reports the new page', async () => {
    await openURL({ url: base + '/' }, mgr);
    const r = await browserType({ query: 'email', text: 'a@b.c', pressEnter: true }, mgr);
    assert.equal(r.success, true, r.error);
  });
  await test('clicking by words: "video link" finds the link; the page navigates', async () => {
    await openURL({ url: base + '/' }, mgr);
    const r = await browserClick({ query: 'video link' }, mgr);
    assert.equal(r.success, true, r.error);
    assert.match(r.data, /\/video\/1/);
  });
  await test('an unknown control is NOT replaced by some other input or button', async () => {
    await openURL({ url: base + '/' }, mgr);
    const page = await mgr.getActivePage();
    const resolver = new DomResolver(page);
    assert.equal(await resolver.resolve('Purchase subscription', null, { timeoutMs: 400 }), null);
    assert.equal(await resolver.resolve('Delete account button', null, { timeoutMs: 400 }), null);
    const r = await browserClick({ query: 'Launch the rockets' }, mgr);
    assert.equal(r.success, false);
  });
  await test('a click that changes nothing is reported honestly; one that changes the page says so', async () => {
    const like = await browserClick({ query: 'Like' }, mgr);
    assert.equal(like.success, true);
    assert.equal(like.verdict, 'unchanged');
    assert.match(like.data, /did not visibly change/);
    const play = await browserClick({ query: 'Play button' }, mgr);
    assert.equal(play.verdict, 'changed');
  });
  await test('words with regex/CSS characters do not crash the search ("c++ docs", quotes)', async () => {
    const r = await browserClick({ query: 'C++ docs' }, mgr);
    assert.equal(r.success, true, r.error);
    const odd = await browserClick({ query: 'say "hi" [x] (y) *', }, mgr);
    assert.equal(odd.success, false);
    assert.match(odd.error, /Could not find/);
  });
  await test('a link that opens a new tab: that tab becomes the one in use', async () => {
    await openURL({ url: base + '/' }, mgr);
    const r = await browserClick({ query: 'popup page' }, mgr);
    assert.equal(r.success, true, r.error);
    assert.equal(r.verdict, 'changed');
    assert.match((await browserRead({}, mgr)).data, /\/popup/);
  });
  await test('tabs: list, switch by words, close', async () => {
    const list = await browserTabs({ action: 'list' }, mgr);
    assert.match(list.data, /popup/);
    assert.match(list.data, /Fixture Home|127\.0\.0\.1/);
    const sw = await browserTabs({ action: 'switch', query: 'popup' }, mgr);
    assert.equal(sw.success, true, sw.error);
    const none = await browserTabs({ action: 'switch', query: 'spreadsheet quarterly' }, mgr);
    assert.equal(none.success, false);
    const closed = await browserTabs({ action: 'close', query: 'popup' }, mgr);
    assert.equal(closed.success, true, closed.error);
    const next = await browserRead({}, mgr);            // active tab was closed: Rocky moves to a remaining one
    assert.equal(next.success, true, next.error);
    const fresh = await browserTabs({ action: 'new', url: base + '/new' }, mgr);
    assert.match(fresh.data, /\/new/);
    assert.equal((await browserTabs({ action: 'new', url: 'file:///etc/passwd' }, mgr)).success, false);
  });

  await test('media: finds the audio on the page and reports it; nothing playing is not an error', async () => {
    await openURL({ url: base + '/player' }, mgr);
    const st = await browserMedia({ action: 'status' }, mgr);
    assert.equal(st.success, true, st.error);
    assert.match(st.data, /paused at 0:00 of 0:30/);
  });
  await test('media: play, status, pause', async () => {
    const play = await browserMedia({ action: 'play' }, mgr);
    assert.equal(play.success, true, play.error);
    assert.match(play.data, /playing/);
    const pause = await browserMedia({ action: 'pause' }, mgr);
    assert.match(pause.data, /paused/);
    const t = await browserMedia({ action: 'toggle' }, mgr);
    assert.match(t.data, /playing/);
    await browserMedia({ action: 'pause' }, mgr);
  });
  await test('media: seek to a time, skip forward and back (clamped at the ends)', async () => {
    assert.match((await browserMedia({ action: 'seek', value: '0:20' }, mgr)).data, /at 0:20 of 0:30/);
    assert.match((await browserMedia({ action: 'forward', value: 5 }, mgr)).data, /at 0:25/);
    assert.match((await browserMedia({ action: 'back', value: '10 sec' }, mgr)).data, /at 0:15/);
    assert.match((await browserMedia({ action: 'back', value: 999 }, mgr)).data, /at 0:00/);
    assert.match((await browserMedia({ action: 'seek', value: 999 }, mgr)).data, /at 0:29 of 0:30/);
  });
  await test('media: volume, mute, speed', async () => {
    assert.match((await browserMedia({ action: 'volume', value: '30%' }, mgr)).data, /volume 30%/);
    assert.match((await browserMedia({ action: 'mute' }, mgr)).data, /\(muted\)/);
    assert.doesNotMatch((await browserMedia({ action: 'unmute' }, mgr)).data, /muted/);
    assert.match((await browserMedia({ action: 'speed', value: '1.5x' }, mgr)).data, /speed 1.5x/);
  });
  await test('media: bad values are refused with a hint, never applied', async () => {
    for (const a of [{ action: 'seek', value: 'soon' }, { action: 'volume', value: 'loud' }, { action: 'speed', value: 'fast' }, { action: 'explode' }]) {
      const r = await browserMedia(a, mgr);
      assert.equal(r.success, false, JSON.stringify(a));
    }
    assert.match((await browserMedia({ action: 'status' }, mgr)).data, /volume 30%/, 'state unchanged by the refused commands');
  });
  await test('media: the tab with sound is controlled even when Rocky is looking at another tab', async () => {
    await browserMedia({ action: 'seek', value: 5 }, mgr);
    await browserMedia({ action: 'play' }, mgr);
    await browserTabs({ action: 'new', url: base + '/' }, mgr);          // now on a page without media
    const r = await browserMedia({ action: 'pause' }, mgr);
    assert.equal(r.success, true, r.error);
    assert.match(r.data, /Player Page/);
    assert.match((await browserRead({}, mgr)).data, /Player Page|button "Play"/);
  });
  await test('media: next uses the page\'s Next button', async () => {
    const r = await browserMedia({ action: 'next' }, mgr);
    assert.equal(r.success, true, r.error);
    assert.match(r.data, /Pressed "Next"/);
  });
  await test('media: seeking a paused player works from another tab (the last-used player is remembered)', async () => {
    const r = await browserMedia({ action: 'seek', value: '0:07' }, mgr);
    assert.match(r.data, /Player Page/);
    assert.match(r.data, /at 0:07 of 0:30/);
  });
  await test('media: a page with no media says so', async () => {
    await openURL({ url: base + '/' }, mgr);
    for (const t of await mgr.listTabs()) if (!t.url.endsWith('/')) await t.page.close();
    const r = await browserMedia({ action: 'pause' }, mgr);
    assert.equal(r.success, false);
    assert.match(r.error, /no video or audio/);
  });
  await test('Rocky "restarts": a new manager attaches to the SAME running browser and sees its tabs', async () => {
    await browserTabs({ action: 'new', url: base + '/marker' }, mgr);
    await mgr.disconnect();
    assert.equal((await probeEndpoint(port)).ok, true, 'browser must survive Rocky disconnecting');
    const again = mk();
    const tabs = await again.listTabs();
    assert.ok(tabs.some((t) => t.url.includes('/marker')), JSON.stringify(tabs.map((t) => t.url)));
    await again.disconnect();
  });
  await test('browser closed behind Rocky\'s back: the next tool call starts it again', async () => {
    const m = mk();
    await m.getContext();
    const ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await (await b.newBrowserCDPSession()).send('Browser.close').catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await probeEndpoint(port)).ok, false);
    const r = await openURL({ url: base + '/' }, m);
    assert.equal(r.success, true, r.error);
    await m.disconnect();
    void ws;
  });

  // Tidy up: close the browser we started.
  try {
    const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await (await b.newBrowserCDPSession()).send('Browser.close').catch(() => {});
  } catch { /* already closed */ }
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
