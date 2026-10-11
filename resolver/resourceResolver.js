import path from 'path';
import { fileURLToPath } from 'url';
import { appCatalog } from './installedApps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Universal Resource Resolver — Pillar 2: Dynamic Capability Resolution
 *
 * Resolves an ambiguous query ("spotify", "gmail", "youtube") into a
 * physical launch target and resource type.
 *
 * Resolution order:
 *   1. In-memory cache (10-min TTL) — instant
 *   2. Learned mappings from AppActionMapper — user-trained
 *   3. Installed-apps catalog (strong match) — what is really on this PC
 *   4. Known web services
 *   5. Installed-apps catalog (weaker match)
 *   6. Static table of Windows built-ins / common apps — safety net
 *   7. URL heuristic
 *   8. Unknown — caller must ask the user
 *
 * The catalog (appCatalog.js) replaces the old per-lookup PowerShell regex query,
 * which started a process every time, took whichever app matched first, and
 * returned IDs the launcher could not always start.
 */

// ── Static tables ────────────────────────────────────────────────────────────

/**
 * Known Win32 executables and UWP app IDs.
 * Kept here so the live PS query is the primary path; this is the safety net.
 */
const WIN32_EXECUTABLES = {
  // Productivity
  notepad:     'notepad.exe',
  wordpad:     'wordpad.exe',
  paint:       'mspaint.exe',
  calculator:  'calc.exe',
  calendar:    'outlookcal:',
  clock:       'ms-clock:',
  'sticky notes': 'Microsoft.MicrosoftStickyNotes_8wekyb3d8bbwe!App',

  // Dev tools
  vscode:      'code',
  'visual studio code': 'code',
  powershell:  'powershell.exe',
  cmd:         'cmd.exe',
  terminal:    'wt.exe',
  notepadpp:   'notepad++.exe',

  // Browsers
  chrome:      'chrome.exe',
  firefox:     'firefox.exe',
  edge:        'msedge.exe',
  brave:       'brave.exe',
  opera:       'opera.exe',

  // Communication
  slack:       'slack.exe',
  teams:       'teams.exe',
  discord:     'discord.exe',
  zoom:        'zoom.exe',
  skype:       'skype.exe',
  whatsapp:    'whatsapp.exe',
  telegram:    'telegram.exe',
  signal:      'signal.exe',

  // Media
  spotify:     'spotify.exe',
  vlc:         'vlc.exe',
  'media player': 'wmplayer.exe',
  itunes:      'itunes.exe',
  plex:        'plex.exe',

  // Files & System
  explorer:    'explorer.exe',
  'file explorer': 'explorer.exe',
  'task manager':  'taskmgr.exe',
  settings:    'ms-settings:',
  'control panel': 'control.exe',

  // Creative
  photoshop:   'photoshop.exe',
  illustrator: 'illustrator.exe',
  figma:       'figma.exe',
  gimp:        'gimp.exe',
};

/**
 * Known web services.
 * Maps a query string to a canonical URL.
 */
const WEB_SERVICES = {
  youtube:      'https://youtube.com',
  gmail:        'https://mail.google.com',
  github:       'https://github.com',
  twitter:      'https://twitter.com',
  x:            'https://x.com',
  reddit:       'https://reddit.com',
  linkedin:     'https://linkedin.com',
  instagram:    'https://instagram.com',
  facebook:     'https://facebook.com',
  notion:       'https://notion.so',
  trello:       'https://trello.com',
  jira:         'https://jira.atlassian.com',
  confluence:   'https://confluence.atlassian.com',
  figma:        'https://figma.com',
  canva:        'https://canva.com',
  drive:        'https://drive.google.com',
  'google drive': 'https://drive.google.com',
  docs:         'https://docs.google.com',
  sheets:       'https://sheets.google.com',
  meet:         'https://meet.google.com',
  netflix:      'https://netflix.com',
  'amazon prime': 'https://primevideo.com',
  chatgpt:      'https://chat.openai.com',
  claude:       'https://claude.ai',
  perplexity:   'https://perplexity.ai',
  'stack overflow': 'https://stackoverflow.com',
  stackoverflow: 'https://stackoverflow.com',
  npm:          'https://npmjs.com',
  mdn:          'https://developer.mozilla.org',
};

// ── In-memory resolution cache ───────────────────────────────────────────────

const _cache = new Map(); // key → { result, expiresAt }
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.result;
}

function _cacheSet(key, result) {
  _cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Built-ins that exist on every Windows PC even if the Start-menu scan does not list them
// (shell shortcuts and system tools). Everything else in the static table is only trusted
// when the installed-apps catalog is not available.
const ALWAYS_PRESENT = new Set([
  'notepad', 'wordpad', 'paint', 'calculator', 'calendar', 'clock', 'explorer', 'file explorer',
  'task manager', 'settings', 'control panel', 'cmd', 'powershell', 'terminal',
]);
const CATALOG_HEALTHY_MIN = 10;   // fewer apps than this means the scan did not really work

/** Look the query up in the installed-apps catalog, but never wait on a slow scan for long. */
async function findInstalled(query) {
  try {
    const found = await Promise.race([
      appCatalog.find(query),
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (!found?.best) return null;
    const e = found.best;
    return {
      type: 'desktop',
      target: e.appId,
      appId: e.appId,
      displayName: e.name,
      exe: e.exe,
      kind: e.kind,
      confidence: Math.min(0.99, found.score),
      source: 'catalog',
      matchedBy: found.why,
      ambiguous: found.ambiguous,
      alternatives: found.matches.slice(1).map((m) => m.entry.name),
    };
  } catch {
    return null;
  }
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * @param {string} query - User-provided app or service name
 * @param {object} context - AgentLoop context (unused currently, reserved for future learning)
 * @param {object|null} appActionMapper - Optional learned mappings from user history
 * @returns {Promise<{type: string, target: string, confidence: number}>}
 */
export default async function resolveResource(query, context, appActionMapper = null) {
  const normalizedQuery = String(query || '').toLowerCase().trim();
  if (!normalizedQuery) return { type: 'unknown', target: '', confidence: 0 };

  // 0. Cache hit
  const cached = _cacheGet(normalizedQuery);
  if (cached) {
    console.log(`[ResourceResolver] Cache hit for "${normalizedQuery}"`);
    return cached;
  }

  let result;

  // 1. Learned mappings (highest confidence — user-trained)
  if (appActionMapper) {
    try {
      const learned = await appActionMapper.mapIntentToAction(`open_${normalizedQuery}`, null);
      if (learned?.args?.preferredType) {
        result = {
          type: learned.args.preferredType,
          target: learned.args.target || normalizedQuery,
          confidence: 1.0,
          source: 'learned'
        };
      }
    } catch { /* mapper not ready */ }
  }

  // 2. What is really installed on this PC. A strong match wins even over the web list:
  //    "open spotify" means the app when the app is there.
  const installed = await findInstalled(normalizedQuery);
  if (!result && installed && installed.confidence >= 0.9) result = installed;

  // 3. Static web service table (fast, no I/O)
  if (!result && WEB_SERVICES[normalizedQuery]) {
    result = {
      type: 'web',
      target: WEB_SERVICES[normalizedQuery],
      confidence: 0.95,
      source: 'web_table'
    };
  }

  // 4. A weaker installed-app match (close spelling, words inside the name)
  if (!result && installed) result = installed;

  // 5. Static table of built-ins / common apps. If the catalog is working and does not list the
  //    app, it is not installed: say so instead of trying to start an .exe that is not there.
  const catalogHealthy = appCatalog.size >= CATALOG_HEALTHY_MIN;
  if (!result && WIN32_EXECUTABLES[normalizedQuery]) {
    if (!catalogHealthy || ALWAYS_PRESENT.has(normalizedQuery)) {
      result = {
        type: 'desktop',
        target: WIN32_EXECUTABLES[normalizedQuery],
        confidence: catalogHealthy ? 0.9 : 0.75,
        source: 'static_table'
      };
    } else {
      result = { type: 'unknown', target: normalizedQuery, confidence: 0.1, source: 'none', reason: 'not_installed' };
    }
  }

  // 5. URL/domain heuristic
  if (!result) {
    const hasProtocol = normalizedQuery.startsWith('http');
    const hasTLD = /\.[a-z]{2,}(\/|$)/.test(normalizedQuery);
    if (hasProtocol || hasTLD) {
      result = {
        type: 'web',
        target: hasProtocol ? normalizedQuery : `https://${normalizedQuery}`,
        confidence: 0.7,
        source: 'url_heuristic'
      };
    }
  }

  // 6. Unknown — let caller decide
  if (!result) {
    result = { type: 'unknown', target: normalizedQuery, confidence: 0.1, source: 'none', reason: catalogHealthy ? 'not_installed' : 'unknown' };
  }

  console.log(`[ResourceResolver] "${normalizedQuery}" → type=${result.type}, target=${result.target}, src=${result.source}`);
  if (result.type !== 'unknown') _cacheSet(normalizedQuery, result);
  return result;
}
