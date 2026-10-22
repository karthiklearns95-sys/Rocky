import * as lancedb from '@lancedb/lancedb';
import { installedAppLaunchPlan, plainText } from '../../resolver/appLaunchPlan.js';
import { ctxText } from './planUtils.js';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import config from '../../config/app.config.js';
import { appCatalog } from '../../resolver/installedApps.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Semantic Router (L0): a fast path for a handful of very common commands.
 *
 * What Grace SAID is turned into an embedding and compared with a few example phrases per intent
 * ("open notepad", "take a note"...). A close match runs a ready-made plan with no LLM call.
 *
 * Because a match runs actions without anyone reading the sentence, it is deliberately strict:
 *   - cosine distance must be small AND clearly better than every other intent (margin);
 *   - short sentences only (long ones carry details a canned plan would drop);
 *   - never when the sentence names a different app/site, or says close/stop/quit/delete...
 *     (opposites embed almost the same as "open notepad");
 * and anything doubtful falls through to the normal planner. It never blocks a command: until the
 * example phrases are embedded (warmUp runs at start-up) or if Ollama is slow, it just steps aside.
 */

/** Example phrases per intent. Only unambiguous ones: "send a message" could mean email or Teams. */
export const CLUSTERS = [
  { text: 'open spotify', intent: 'LaunchApp_Spotify' },
  { text: 'play music', intent: 'LaunchApp_Spotify' },
  { text: 'put on some tunes', intent: 'LaunchApp_Spotify' },
  { text: 'start spotify', intent: 'LaunchApp_Spotify' },
  { text: 'play a song', intent: 'LaunchApp_Spotify' },

  { text: 'open whatsapp', intent: 'LaunchApp_WhatsApp' },
  { text: 'message someone on whatsapp', intent: 'LaunchApp_WhatsApp' },
  { text: 'text my friend', intent: 'LaunchApp_WhatsApp' },

  { text: 'open notepad', intent: 'LaunchApp_Notepad' },
  { text: 'write something down', intent: 'LaunchApp_Notepad' },
  { text: 'take a note', intent: 'LaunchApp_Notepad' },
  { text: 'jot this down', intent: 'LaunchApp_Notepad' },

  { text: 'open calculator', intent: 'LaunchApp_Calculator' },
  { text: 'do some math', intent: 'LaunchApp_Calculator' },
  { text: 'calculate this', intent: 'LaunchApp_Calculator' },

  { text: 'open chrome', intent: 'LaunchApp_Chrome' },
  { text: 'browse the web', intent: 'LaunchApp_Chrome' },
];

/** The one app each intent is about; anything else named in the sentence means "not this intent". */
const INTENT_TARGET = {
  LaunchApp_Spotify: 'spotify', LaunchApp_WhatsApp: 'whatsapp', LaunchApp_Notepad: 'notepad',
  LaunchApp_Calculator: 'calculator', LaunchApp_Chrome: 'chrome',
};
const OTHER_TARGETS = ['spotify', 'whatsapp', 'notepad', 'calculator', 'chrome', 'edge', 'firefox', 'youtube', 'netflix', 'google', 'gmail', 'outlook',
  'teams', 'discord', 'telegram', 'slack', 'zoom', 'instagram', 'facebook', 'twitter', 'reddit', 'amazon', 'twitch', 'soundcloud', 'apple music', 'word', 'excel', 'powerpoint'];
const OPPOSITE_WORDS = /\b(close|quit|exit|kill|stop|cancel|delete|remove|uninstall|minimi[sz]e|maximi[sz]e|restart|reboot|shut ?down|don'?t|do not|never|without)\b/;

/** Scale to unit length so cosine distance is meaningful whatever the embedding model returns. */
export function normalizeVector(v) {
  if (!Array.isArray(v) && !ArrayBuffer.isView(v)) return null;
  let sum = 0;
  for (const x of v) { if (!Number.isFinite(x)) return null; sum += x * x; }
  if (sum === 0) return null;
  const n = Math.sqrt(sum);
  return Array.from(v, (x) => x / n);
}

/**
 * Pick an intent from nearest-neighbour rows [{intent, text, _distance}] (cosine distance, best
 * first). Returns { intent, distance, text } or { reason }.
 */
export function decideIntent(rows, { maxDistance, minMargin }) {
  if (!rows?.length) return { reason: 'no examples' };
  const best = rows[0];
  const d = Number(best._distance);
  if (!Number.isFinite(d)) return { reason: 'no distance' };
  if (d > maxDistance) return { reason: `too far (${d.toFixed(3)} > ${maxDistance})`, distance: d, text: best.text };
  const rival = rows.find((r) => r.intent !== best.intent);
  if (rival && Number(rival._distance) - d < minMargin) {
    return { reason: `too close to "${rival.text}" (${rival.intent}) (margin ${(Number(rival._distance) - d).toFixed(3)} < ${minMargin})`, distance: d, text: best.text };
  }
  return { intent: best.intent, distance: d, text: best.text };
}

/**
 * Reasons not to trust the fast path for this sentence, whatever the embedding says. null = fine.
 * @param {string} spoken what Grace said
 * @param {string} intent
 * @param {{ maxWords: number, mentioned?: (text: string) => string|null }} opts
 *        mentioned: name of an installed app named in the sentence (appCatalog.findMentioned)
 */
export function routeGuard(spoken, intent, { maxWords = 8, mentioned = () => null } = {}) {
  const text = String(spoken || '').toLowerCase();
  if (text.split(/\s+/).filter(Boolean).length > maxWords) return 'sentence too long for a canned plan';
  if (OPPOSITE_WORDS.test(text)) return 'sentence asks for the opposite or a negation';
  const target = INTENT_TARGET[intent];
  const named = OTHER_TARGETS.find((t) => t !== target && new RegExp(`\\b${t}\\b`).test(text));
  if (named) return `names another target (${named})`;
  const app = mentioned(text);
  if (app && !String(app).toLowerCase().includes(target)) return `names another installed app (${app})`;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (promise, ms) => Promise.race([promise, sleep(ms).then(() => { throw new Error(`timed out after ${ms} ms`); })]);

export class SemanticRouter {
  constructor({ dbPath = path.join(__dirname, '..', '..', 'data', 'vector'), settings = config.router, catalog = appCatalog, clusters = CLUSTERS, now = Date.now } = {}) {
    this.dbPath = dbPath;
    this.settings = settings;
    this.catalog = catalog;
    this.clusters = clusters;
    this.now = now;
    this.db = null;
    this.table = null;
    this.dim = 0;
    this.warming = null;
    this.retryAt = 0;
    this.initPromise = this.init();
  }

  async init() {
    try {
      this.db = await lancedb.connect(this.dbPath);
    } catch (e) {
      console.error(`[SemanticRouter] Init error:`, e.message);
    }
  }

  /** Table name that changes whenever the examples or the embedding size change, so stale ones are never used. */
  _tableName(dim) {
    const h = crypto.createHash('sha1').update(JSON.stringify(this.clusters)).digest('hex').slice(0, 8);
    return `fast_path_v2_${dim}_${h}`;
  }

  /** Embed the example phrases once. Safe to call repeatedly; never throws; never blocks a command. */
  warmUp(aiProvider) {
    if (this.table) return Promise.resolve(true);
    if (this.warming) return this.warming;
    if (this.now() < this.retryAt) return Promise.resolve(false);
    this.warming = this._seed(aiProvider)
      .catch((e) => { console.error(`[SemanticRouter] Seeding error:`, e.message); return false; })
      .then((ok) => {
        this.warming = null;
        if (!ok) {
          // Ollama may still be starting or busy loading the brain model: try again by itself later,
          // so the fast path becomes ready without waiting for a command to ask.
          this.retryAt = this.now() + this.settings.retrySeedMs;
          clearTimeout(this._retryTimer);
          this._retryTimer = setTimeout(() => this.warmUp(aiProvider), this.settings.retrySeedMs);
          this._retryTimer.unref?.();
        }
        return ok;
      });
    return this.warming;
  }

  async _seed(aiProvider) {
    await this.initPromise;
    if (!this.db || typeof aiProvider?.embed !== 'function') return false;

    const rows = [];
    for (const c of this.clusters) {
      // The first request also loads the embedding model into Ollama, which can take a while at start-up.
      const limit = rows.length ? this.settings.seedTimeoutMs : Math.max(this.settings.seedTimeoutMs, this.settings.firstEmbedTimeoutMs || 0);
      const vector = normalizeVector(await withTimeout(aiProvider.embed(c.text), limit));
      if (!vector) throw new Error(`could not embed "${c.text}" (is the embedding model installed?)`);   // all or nothing
      if (rows.length && vector.length !== rows[0].vector.length) throw new Error('embedding size changed while seeding');
      rows.push({ vector, text: c.text, intent: c.intent });
    }
    const dim = rows[0].vector.length;
    const name = this._tableName(dim);
    const existing = await this.db.tableNames();
    for (const old of existing) if (old.startsWith('fast_path') && old !== name) await this.db.dropTable(old).catch(() => {});
    this.table = existing.includes(name) ? await this.db.openTable(name) : await this.db.createTable(name, rows);
    this.dim = dim;
    console.log(`[SemanticRouter] Ready: ${rows.length} example phrases (${dim}-dim).`);
    return true;
  }

  async getDeterministicRoute(ctx, aiProvider) {
    const spoken = plainText(ctx);
    if (!spoken) return null;

    // "open <any installed app>": no LLM, no vector database and no seeding needed.
    const launch = installedAppLaunchPlan(spoken);
    if (launch) return launch;

    // Single-word app names.
    const knownApps = ['spotify', 'notepad', 'calculator', 'chrome', 'whatsapp'];
    if (knownApps.includes(spoken)) {
      console.log(`[SemanticRouter] Direct app name trigger: ${spoken}`);
      return this._buildRoutePlan(`LaunchApp_${spoken.charAt(0).toUpperCase() + spoken.slice(1)}`, ctx);
    }

    if (!this.settings.enabled) return null;
    if (!this.table) { this.warmUp(aiProvider); return null; }   // not ready: the planner handles this one

    try {
      const vector = normalizeVector(await withTimeout(aiProvider.embed(spoken), this.settings.queryTimeoutMs));
      if (!vector) return null;
      if (vector.length !== this.dim) {
        console.warn(`[SemanticRouter] Embedding size ${vector.length} differs from the examples' ${this.dim}; skipping the fast path.`);
        return null;
      }

      let rows = await this.table.search(vector).distanceType('cosine').limit(6).toArray();
      rows = Array.from(rows || []).sort((x, y) => x._distance - y._distance);

      const pick = decideIntent(rows, this.settings);
      if (!pick.intent) {
        console.log(`[SemanticRouter] No fast path for "${spoken}": ${pick.reason}.`);
        return null;
      }
      const why = routeGuard(spoken, pick.intent, { maxWords: this.settings.maxWords, mentioned: (t) => this.catalog?.findMentioned?.(t)?.name || null });
      if (why) {
        console.log(`[SemanticRouter] "${spoken}" resembles "${pick.text}" but is left to the planner: ${why}.`);
        return null;
      }
      console.log(`[SemanticRouter] Fast path ${pick.intent} for "${spoken}" (matches "${pick.text}", distance ${pick.distance.toFixed(3)}).`);
      return this._buildRoutePlan(pick.intent, ctx);
    } catch (e) {
      console.error(`[SemanticRouter] Search error:`, e.message);
      return null;
    }
  }

  // --- Helper Extraction Methods ---

  _asEntityValue(value) {
    if (Array.isArray(value)) return value[0];
    return value;
  }

  _extractSearchText(ctx) {
    const entities = ctx.intentData?.entities || {};
    const direct = this._asEntityValue(entities.song || entities.artist || entities.query || entities.search);
    if (direct) return String(direct);

    const raw = String(ctxText(ctx));
    const searchMatch = raw.match(/\bsearch\s+(?:for\s+)?(.+?)(?:,?\s+and\s+play|,?\s+and\s+open|$)/i);
    if (searchMatch) return searchMatch[1].trim();

    const playMatch = raw.match(/\bplay\s+(.+?)(?:\s+on\s+\w+|$)/i);
    if (playMatch) return playMatch[1].trim();
    return null;
  }
  
  _extractContactAndMessage(ctx) {
    const entities = ctx.intentData?.entities || {};
    const contact = this._asEntityValue(entities.contact || entities.person || entities.target);
    const msg = this._asEntityValue(entities.message || entities.text);
    return {
       contact: contact ? String(contact) : null,
       message: msg ? String(msg) : null     // never invent a message: sending cannot be undone
    };
  }

  _extractTextToType(ctx) {
    const text = String(ctxText(ctx));
    const quoted = text.match(/["'“”](.+?)["'“”]/);
    if (quoted) return quoted[1];
    const writeMatch = text.match(/\b(?:write|type)\s+(.+)$/i);
    if (writeMatch) return writeMatch[1].trim();
    return 'Reminder: drink water.';
  }

  _buildRoutePlan(intent, ctx) {
    switch (intent) {
      case 'LaunchApp_Spotify': {
        const query = this._extractSearchText(ctx);
        if (query) {
          return [
            { tool: 'open_resource', input: { query: 'spotify' } },
            { tool: 'waitForAppReady', input: { appName: 'spotify' } },
            { tool: 'focusWindow', input: { appName: 'spotify' } },
            { tool: 'pressKey', input: { key: '^l' } },
            { tool: 'typeText', input: { text: query } },
            { tool: 'pressKey', input: { key: '{ENTER}' } },
            { tool: 'pressKey', input: { key: '{TAB}' } },
            { tool: 'pressKey', input: { key: '{ENTER}' } }
          ];
        }
        return [
          { tool: 'open_resource', input: { query: 'spotify' } },
          { tool: 'waitForAppReady', input: { appName: 'spotify' } },
          { tool: 'focusWindow', input: { appName: 'spotify' } }
        ];
      }
      case 'LaunchApp_WhatsApp': {
        const { contact, message } = this._extractContactAndMessage(ctx);
        if (contact) {
            // Opens the chat; the message is typed and sent only when Grace actually said one.
            const steps = [
              { tool: 'open_resource', input: { query: 'whatsapp' } },
              { tool: 'waitForAppReady', input: { appName: 'whatsapp' } },
              { tool: 'focusWindow', input: { appName: 'whatsapp' } },
              { tool: 'pressKey', input: { key: '^f' } },
              { tool: 'typeText', input: { text: contact } },
              { tool: 'pressKey', input: { key: '{ENTER}' } }
            ];
            if (message) steps.push({ tool: 'typeText', input: { text: message } }, { tool: 'pressKey', input: { key: '{ENTER}' } });
            return steps;
        }
        return [
            { tool: 'open_resource', input: { query: 'whatsapp' } },
            { tool: 'waitForAppReady', input: { appName: 'whatsapp' } },
            { tool: 'focusWindow', input: { appName: 'whatsapp' } }
        ];
      }
      case 'LaunchApp_Notepad': {
        const hasWrite = /\b(write|type)\b/.test(String(ctxText(ctx)).toLowerCase());
        if (hasWrite) {
          const text = this._extractTextToType(ctx);
          return [
            { tool: 'open_resource', input: { query: 'notepad' } },
            { tool: 'waitForAppReady', input: { appName: 'notepad' } },
            { tool: 'focusWindow', input: { appName: 'notepad' } },
            { tool: 'typeText', input: { text } }
          ];
        }
        return [
          { tool: 'open_resource', input: { query: 'notepad' } },
          { tool: 'waitForAppReady', input: { appName: 'notepad' } },
          { tool: 'focusWindow', input: { appName: 'notepad' } }
        ];
      }
      case 'LaunchApp_Calculator': {
         const lower = String(ctxText(ctx)).toLowerCase();
         const expressionMatch = lower.match(/\b(?:calculate|what is|how much is)\s+([0-9+\-*/().\s]+)/i);
         if (expressionMatch && expressionMatch[1].trim()) {
           return [
             { tool: 'open_resource', input: { query: 'calculator' } },
             { tool: 'waitForAppReady', input: { appName: 'calculator' } },
             { tool: 'focusWindow', input: { appName: 'calculator' } },
             { tool: 'calculate', input: { expression: expressionMatch[1].trim() } }
           ];
         }
         return [
          { tool: 'open_resource', input: { query: 'calculator' } },
          { tool: 'waitForAppReady', input: { appName: 'calculator' } },
          { tool: 'focusWindow', input: { appName: 'calculator' } }
        ];
      }
      case 'LaunchApp_Chrome':
        return [
          { tool: 'open_resource', input: { query: 'chrome' } },
          { tool: 'waitForAppReady', input: { appName: 'chrome' } },
          { tool: 'focusWindow', input: { appName: 'chrome' } }
        ];
      default:
        return null;
    }
  }
}

export const semanticRouter = new SemanticRouter();
