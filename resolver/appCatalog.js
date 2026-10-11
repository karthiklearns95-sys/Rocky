import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * AppCatalog - what is actually installed on this PC.
 *
 * Rocky used to know about ~45 hand-listed apps. This reads the Start menu app
 * list (desktop programs and Store apps alike), keeps it on disk so start-up is
 * instant, refreshes it in the background, and answers "which app did Grace
 * mean by X?" with a ranked, explainable match:
 *
 *   exact name > alias (name without vendor/version, exe name, acronym,
 *   Grace's own words) > name starts with it > all words present > close
 *   spelling (speech-recognition slips like "calculater")
 *
 * It also learns: apps Grace actually launches get a small boost, so "code"
 * picks the editor she uses over an app that merely contains the word.
 * When two different apps are equally likely it says so (ambiguous) instead of
 * guessing.
 *
 * All I/O is injected (loader, store path, clock), so the matching is testable
 * without Windows.
 */

const DAY = 24 * 60 * 60 * 1000;

// Vendor / marketing words that people leave out when naming an app.
const VENDORS = new Set(['microsoft', 'google', 'adobe', 'mozilla', 'oracle', 'jetbrains', 'apple', 'samsung', 'dell', 'hp', 'intel', 'nvidia', 'amd', 'realtek', 'windows']);
const NOISE_WORDS = new Set(['the', 'app', 'application', 'desktop', 'for', 'of', 'and', 'x64', 'x86', 'bit', '64', '32']);
// Start-menu entries that are not apps anyone wants to "open".
const NOT_APPS = /\b(uninstall|uninstaller|readme|read me|release notes|documentation|user guide|user manual|license|eula|website|web site|online help|help file|manual|changelog|repair)\b/i;
// Everyday words that happen to be app names; never infer an app from them inside a sentence.
const COMMON_WORDS = new Set(['photos', 'phone', 'maps', 'clock', 'camera', 'store', 'news', 'weather', 'people', 'mail', 'notes', 'movies', 'music', 'video', 'games', 'tips', 'feedback', 'calendar', 'home', 'search', 'settings', 'help', 'media', 'files', 'print', 'scan', 'run', 'record']);

/** Lower-case words; keeps the meaning of + # & so "Notepad++" and "Notepad" stay different. */
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\+\+/g, ' plus plus ')
    .replace(/\+/g, ' plus ')
    .replace(/#/g, ' sharp ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const words = (s) => normalize(s).split(' ').filter(Boolean);

function stripExt(file) {
  return file.replace(/\.(exe|lnk|bat|cmd)$/i, '');
}

/** Turn a raw {name, appId} from Windows into a catalog entry with its aliases. */
export function makeEntry({ name, appId }) {
  const display = String(name || '').trim();
  const id = String(appId || '').trim();
  if (!display || !id) return null;
  if (NOT_APPS.test(display)) return null;

  const kind = id.includes('!') ? 'uwp' : /\.exe$/i.test(id) || /[\\/]/.test(id) || id.startsWith('{') ? 'win32' : 'other';
  const exe = kind === 'win32' && /\.exe$/i.test(id) ? stripExt(id.split(/[\\/]/).pop()).toLowerCase() : null;

  // Name as people say it: no version numbers, bit-ness or parentheses.
  const cleaned = display
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+(\.\d+)*\b/g, ' ')
    .replace(/\b(x64|x86|64-bit|32-bit)\b/gi, ' ');
  const cleanWords = words(cleaned);
  const core = cleanWords.filter((w) => !NOISE_WORDS.has(w));
  const noVendor = core.filter((w) => !VENDORS.has(w));

  const aliases = new Set();
  const add = (a) => { const n = normalize(a); if (n && n.length >= 2) aliases.add(n); };
  add(cleanWords.join(' '));
  add(core.join(' '));
  if (noVendor.length) add(noVendor.join(' '));
  if (exe) add(exe);
  if (noVendor.length >= 2) add(noVendor.map((w) => w[0]).join(''));  // "Visual Studio Code" -> "vsc"
  if (noVendor.length >= 3) {                                           // ... -> "vs code" / "vscode"
    const lead = noVendor.slice(0, -1).map((w) => w[0]).join('');
    add(`${lead} ${noVendor[noVendor.length - 1]}`);
    add(`${lead}${noVendor[noVendor.length - 1]}`);
  }
  if (noVendor.length >= 2) add(noVendor.join(''));                    // "visualstudiocode"

  return {
    name: display,
    appId: id,
    kind,
    exe,
    norm: normalize(display),
    words: words(display),
    aliases: [...aliases],
  };
}

/** Edit distance, capped: returns cap+1 as soon as the strings are further apart than cap. */
export function editDistance(a, b, cap = 2) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** How well does query `q` (already normalized) match this entry? 0..1 with a reason. */
export function scoreEntry(q, entry, extraAliases = []) {
  if (!q) return { score: 0, why: '' };
  if (q === entry.norm) return { score: 1, why: 'exact name' };
  const aliases = [...entry.aliases, ...extraAliases];
  if (aliases.includes(q)) return { score: 0.95, why: 'alias' };

  const qWords = q.split(' ').filter((w) => !NOISE_WORDS.has(w));
  if (qWords.length === 0) return { score: 0, why: '' };
  const nameWords = entry.words.filter((w) => !NOISE_WORDS.has(w) && !/^\d+$/.test(w));

  let best = { score: 0, why: '' };
  const take = (score, why) => { if (score > best.score) best = { score, why }; };

  if (entry.norm.startsWith(`${q} `)) take(0.88, 'name starts with it');
  if (qWords.every((w) => nameWords.includes(w))) {
    take(0.8 + 0.08 * (qWords.length / Math.max(nameWords.length, 1)), 'all words in name');
  }
  // The user said more than the app name ("the spotify app"): the whole name is in the query.
  if (nameWords.length > 0 && nameWords.every((w) => qWords.includes(w)) && nameWords.join('').length >= 3) {
    take(0.7, 'name contained in query');
  }

  // Close spelling, for speech-recognition slips. Only for longer words, so "cmd" never matches "cad".
  const compactQ = qWords.join('');
  const targets = [...aliases.map((a) => a.replace(/ /g, '')), ...nameWords];
  for (const t of targets) {
    if (t.length < 5 || compactQ.length < 5) continue;
    const cap = Math.max(t.length, compactQ.length) >= 9 ? 2 : 1;
    const d = editDistance(compactQ, t, cap);
    if (d > 0 && d <= cap) take(0.78 - 0.08 * d, 'close spelling');
  }
  return best;
}

export class AppCatalog {
  /**
   * @param {object} opts
   * @param {() => Promise<Array<{name:string, appId:string}>>} opts.loader reads the installed apps
   * @param {string|null} [opts.storePath] JSON cache file (null = memory only)
   * @param {() => number} [opts.now]
   */
  constructor({ loader, storePath = path.join(__dirname, '..', 'data', 'app_catalog.json'), now = Date.now, maxAgeMs = DAY, rescanCooldownMs = 10 * 60 * 1000 } = {}) {
    this.loader = loader;
    this.storePath = storePath;
    this.now = now;
    this.maxAgeMs = maxAgeMs;
    this.rescanCooldownMs = rescanCooldownMs;

    this.entries = [];
    this.usage = {};          // appId -> { uses, last }
    this.userAliases = {};    // normalized alias -> appId
    this.scannedAt = 0;
    this.refreshing = null;
    this.loaded = false;
  }

  /** Load the disk cache (instant) and refresh in the background if it is old. Never throws. */
  init() {
    if (this.loaded) return this;
    this.loaded = true;
    try {
      if (this.storePath && fs.existsSync(this.storePath)) {
        const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
        this.entries = (raw.apps || []).map(makeEntry).filter(Boolean);
        this.usage = raw.usage || {};
        this.userAliases = raw.aliases || {};
        this.scannedAt = raw.scannedAt || 0;
      }
    } catch (err) {
      console.warn(`[AppCatalog] Could not read cache (${err.message}); will rescan.`);
    }
    if (this.entries.length === 0 || this.now() - this.scannedAt > this.maxAgeMs) {
      this.refresh().catch(() => {});
    }
    return this;
  }

  get size() { return this.entries.length; }

  /** Re-read the installed apps. Concurrent calls share one scan. */
  refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const raw = await this.loader();
        const seen = new Set();
        const entries = (Array.isArray(raw) ? raw : []).map(makeEntry).filter((e) => e && !seen.has(e.appId) && seen.add(e.appId));
        if (entries.length === 0) throw new Error('no apps returned');
        this.entries = entries;
        this.scannedAt = this.now();
        this._save(raw);
        console.log(`[AppCatalog] ${entries.length} installed apps catalogued.`);
        return entries.length;
      } catch (err) {
        console.warn(`[AppCatalog] Scan failed: ${err.message}`);
        this.scannedAt = this.scannedAt || 0;
        return 0;
      } finally {
        this.refreshing = null;
        this._lastScanTry = this.now();
      }
    })();
    return this.refreshing;
  }

  _save(rawApps) {
    if (!this.storePath) return;
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const apps = rawApps.filter((a) => a && a.name && a.appId).map((a) => ({ name: a.name, appId: a.appId }));
      fs.writeFileSync(this.storePath, JSON.stringify({ version: 1, scannedAt: this.scannedAt, apps, usage: this.usage, aliases: this.userAliases }));
    } catch (err) {
      console.warn(`[AppCatalog] Could not save cache: ${err.message}`);
    }
  }

  _saveMeta() {
    if (!this.storePath || !fs.existsSync(this.storePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      fs.writeFileSync(this.storePath, JSON.stringify({ ...raw, usage: this.usage, aliases: this.userAliases }));
    } catch { /* losing a usage counter is harmless */ }
  }

  /**
   * Rank installed apps for a spoken name. Synchronous, from what is loaded.
   * @returns {{ best: object|null, score: number, why: string, ambiguous: boolean, matches: Array }}
   */
  lookup(query, { limit = 3, minScore = 0.7 } = {}) {
    this.init();
    const q = normalize(query);
    const scored = [];
    for (const entry of this.entries) {
      const extra = Object.entries(this.userAliases).filter(([, id]) => id === entry.appId).map(([a]) => a);
      let { score, why } = scoreEntry(q, entry, extra);
      if (score < minScore) continue;
      // Apps Grace really uses win ties, but never override a better text match.
      const uses = this.usage[entry.appId]?.uses || 0;
      score = Math.min(1, score + Math.min(uses, 5) * 0.012);
      scored.push({ entry, score, why });
    }
    scored.sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length);

    const top = scored.slice(0, limit);
    const best = top[0] || null;
    const second = top[1];
    const ambiguous = Boolean(best && second && best.score < 0.99 && second.score >= best.score - 0.03 && second.entry.appId !== best.entry.appId);
    return { best: best?.entry || null, score: best?.score || 0, why: best?.why || '', ambiguous, matches: top };
  }

  /**
   * Like lookup, but if nothing matches and the catalog has not been refreshed
   * for a few minutes, scan once more (the app may have just been installed).
   */
  async find(query, opts = {}) {
    this.init();
    if (this.entries.length === 0 && this.refreshing) await this.refreshing; // first run: wait for the first scan
    let result = this.lookup(query, opts);
    if (!result.best && this.now() - (this._lastScanTry || this.scannedAt || 0) > this.rescanCooldownMs) {
      if (await this.refresh()) result = this.lookup(query, opts);
    }
    return result;
  }

  /** The app (if any) whose name appears as whole words inside a longer sentence. */
  findMentioned(text) {
    this.init();
    const hay = ` ${normalize(text)} `;
    let best = null;
    for (const entry of this.entries) {
      for (const cand of [entry.norm, ...entry.aliases]) {
        if (cand.length < 4 || COMMON_WORDS.has(cand)) continue;
        if (hay.includes(` ${cand} `) && (!best || cand.length > best.len)) best = { entry, len: cand.length };
      }
    }
    return best?.entry || null;
  }

  /** Remember that Grace launched this app (small preference boost). */
  recordLaunch(appId) {
    if (!appId || !this.entries.some((e) => e.appId === appId)) return;
    const u = this.usage[appId] || { uses: 0, last: 0 };
    this.usage[appId] = { uses: u.uses + 1, last: this.now() };
    this._saveMeta();
  }

  /** Grace's own word for an app ("my editor" -> Visual Studio Code). */
  addAlias(alias, appId) {
    const a = normalize(alias);
    if (!a || !appId) return false;
    this.userAliases[a] = appId;
    this._saveMeta();
    return true;
  }

  /** Names of the apps Grace uses most, for prompts and the benchmark. */
  topApps(n = 10) {
    this.init();
    return this.entries
      .map((e) => ({ e, uses: this.usage[e.appId]?.uses || 0 }))
      .filter((x) => x.uses > 0)
      .sort((a, b) => b.uses - a.uses)
      .slice(0, n)
      .map((x) => x.e.name);
  }
}
