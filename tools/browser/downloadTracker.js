import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Watches downloads in Rocky's browser over the DevTools protocol.
 *
 * The browser is told to save into one folder and to report each download (name, address, progress,
 * done/cancelled), so Rocky knows exactly what finished and where it landed, including downloads
 * Grace starts herself in that window. Nothing is ever opened or run.
 */

/** File types that can run code. They are downloaded like any file, but Rocky says so and never opens them. */
const RISKY = /\.(exe|msi|msix|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|scr|com|pif|jar|dll|lnk|hta|reg|cpl|appx|apk)$/i;
export const isRiskyFile = (name) => RISKY.test(String(name || ''));

export function defaultDownloadDir(configured = null, home = os.homedir()) {
  return configured || path.join(home, 'Downloads');
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A file name that is safe to create on Windows: no path parts, no illegal characters, not a device name. */
export function safeFileName(name) {
  let n = String(name ?? '').replace(/\\/g, '/').split('/').pop();
  n = n.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/[. ]+$/, '').replace(/^\.+/, '').trim();
  if (!n) n = 'download';
  if (RESERVED.test(n)) n = `_${n}`;
  if (n.length > 150) {
    const ext = path.extname(n).slice(0, 20);
    n = n.slice(0, 150 - ext.length) + ext;
  }
  return n;
}

/** `name.ext`, or `name (1).ext`, `name (2).ext`... whichever does not exist yet. Never overwrites. */
export function uniqueName(dir, name, exists = fs.existsSync) {
  const ext = path.extname(name), stem = path.basename(name, ext);
  let candidate = name, i = 0;
  while (exists(path.join(dir, candidate))) candidate = `${stem} (${++i})${ext}`;
  return candidate;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DownloadTracker {
  constructor({ dir = defaultDownloadDir(), fsApi = fs, now = Date.now, keep = 50 } = {}) {
    this.dir = dir;
    this.fsApi = fsApi;
    this.now = now;
    this.keep = keep;
    this.records = [];
    this.cdp = null;
  }

  /** Point a browser connection at the download folder and start listening. Call again after a reconnect. */
  async attach(browser) {
    this.fsApi.mkdirSync(this.dir, { recursive: true });
    const cdp = await browser.newBrowserCDPSession();
    cdp.on('Browser.downloadWillBegin', (e) => this._begin(e));
    cdp.on('Browser.downloadProgress', (e) => this._progress(e));
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: this.dir, eventsEnabled: true });
    this.cdp = cdp;
  }

  _begin(e) {
    this.records.push({
      guid: e.guid, name: e.suggestedFilename || 'download', url: e.url || '',
      state: 'inProgress', received: 0, total: 0, startedAt: this.now(), finishedAt: 0, path: null,
    });
    if (this.records.length > this.keep) this.records.splice(0, this.records.length - this.keep);
  }

  _progress(e) {
    const rec = this.records.find((r) => r.guid === e.guid);
    if (!rec) return;
    rec.received = e.receivedBytes ?? rec.received;
    rec.total = e.totalBytes || rec.total;
    if (e.state === 'completed' || e.state === 'canceled') {
      rec.state = e.state === 'completed' ? 'completed' : 'canceled';
      rec.finishedAt = this.now();
      if (rec.state === 'completed') this._finish(rec);
    }
  }

  /**
   * The browser saves each download under its id ("allowAndName"), so a download can never overwrite
   * a file already in the folder. Give it its real name here, adding (1), (2)... on a clash.
   */
  _finish(rec) {
    const from = path.join(this.dir, rec.guid);
    try {
      const name = uniqueName(this.dir, safeFileName(rec.name), this.fsApi.existsSync);
      this.fsApi.renameSync(from, path.join(this.dir, name));
      rec.path = path.join(this.dir, name);
      rec.savedAs = name;
    } catch (err) {
      rec.state = 'canceled';
      rec.error = `could not save the file (${err.message})`;
    }
  }

  /** Downloads that began at or after `since`. */
  startedSince(since) { return this.records.filter((r) => r.startedAt >= since); }

  /** Resolve with the first download that began after `since`, or null after `ms`. */
  async waitForStart(since, ms = 10000) {
    const end = Date.now() + ms;
    do {
      const rec = this.startedSince(since)[0];
      if (rec) return rec;
      await sleep(50);
    } while (Date.now() < end);
    return null;
  }

  /** Wait for a record to finish. Returns it (check .state) once it is done or `ms` passes. */
  async waitForDone(rec, ms = 60000, signal = null) {
    const end = Date.now() + ms;
    while (rec.state === 'inProgress' && Date.now() < end && !signal?.aborted) await sleep(100);
    return rec;
  }

  recent(n = 10) { return this.records.slice(-n).reverse(); }
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
