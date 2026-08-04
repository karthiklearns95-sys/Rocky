import path from 'path';
import { fileURLToPath } from 'url';
import { execWithTimeout } from '../automation/system/execWithTimeout.js';

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
 *   3. Live OS query via PowerShell Get-StartApps — real installed app list
 *   4. Static Win32 executable table — common apps
 *   5. Web service heuristics — known SaaS / URL patterns
 *   6. Unknown — caller must ask the user
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

// ── Live OS query ─────────────────────────────────────────────────────────────

/**
 * Query Windows' Start menu app list asynchronously.
 * Returns the AppID string for the first match, or null.
 * Uses execWithTimeout so a slow WMI/COM query never hangs the process.
 */
async function _queryInstalledApps(normalizedQuery) {
  try {
    const escapedQuery = normalizedQuery.replace(/'/g, "''");
    const psCmd =
      `powershell -NoProfile -Command ` +
      `"Get-StartApps | Where-Object {$_.Name -match '${escapedQuery}'} | ` +
      `Select-Object -First 1 -ExpandProperty AppID"`;

    const { stdout, timedOut, error } = await execWithTimeout(psCmd, { timeoutMs: 6000 });
    if (timedOut || error) return null;
    const appId = (stdout || '').trim();
    return appId || null;
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

  // 2. Static web service table (fast, no I/O)
  if (!result && WEB_SERVICES[normalizedQuery]) {
    result = {
      type: 'web',
      target: WEB_SERVICES[normalizedQuery],
      confidence: 0.95,
      source: 'web_table'
    };
  }

  // 3. Static Win32 / UWP executable table
  if (!result && WIN32_EXECUTABLES[normalizedQuery]) {
    result = {
      type: 'desktop',
      target: WIN32_EXECUTABLES[normalizedQuery],
      confidence: 0.9,
      source: 'static_table'
    };
  }

  // 4. Live OS query — real installed app list (async, non-blocking)
  if (!result) {
    const appId = await _queryInstalledApps(normalizedQuery);
    if (appId) {
      result = {
        type: 'desktop',
        target: appId,
        confidence: 0.92,
        source: 'os_query'
      };
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
    result = { type: 'unknown', target: normalizedQuery, confidence: 0.1, source: 'none' };
  }

  console.log(`[ResourceResolver] "${normalizedQuery}" → type=${result.type}, target=${result.target}, src=${result.source}`);
  _cacheSet(normalizedQuery, result);
  return result;
}
