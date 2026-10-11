/**
 * Capability Resolver — Pillar 2: Dynamic Capability Resolution
 *
 * Determines what interaction modes are available for a given resolved resource.
 * Used by AgentLoop to select the right UI strategy (UIA, Vision, DOM, MediaKey).
 *
 * Expanded from the original 3-app stub to cover 40+ known apps and resource types.
 */

// Known media-capable desktop apps
const MEDIA_APPS = new Set([
  'spotify', 'spotify.exe',
  'vlc', 'vlc.exe',
  'wmplayer', 'wmplayer.exe',
  'itunes', 'itunes.exe',
  'plex', 'plex.exe',
  'groove', 'groove.exe',
  'foobar2000', 'foobar2000.exe',
  'winamp', 'winamp.exe',
]);

// Apps that expose rich UIA accessibility trees
const UIA_RICH_APPS = new Set([
  'notepad.exe', 'wordpad.exe', 'mspaint.exe', 'calc.exe',
  'explorer.exe', 'taskmgr.exe', 'control.exe',
  'code',                       // VS Code
  'slack.exe', 'teams.exe', 'discord.exe', 'zoom.exe',
  'chrome.exe', 'msedge.exe', 'firefox.exe',
  'powershell.exe', 'cmd.exe', 'wt.exe',
  'outlook.exe', 'winword.exe', 'excel.exe', 'powerpnt.exe',
]);

// Electron / hybrid apps — UIA + some DOM
const HYBRID_APPS = new Set([
  'slack.exe', 'discord.exe', 'teams.exe',
  'whatsapp.exe', 'telegram.exe', 'signal.exe',
  'figma.exe', 'notion.exe',
  'code',  // VS Code is Electron
]);

// Web URLs that support media control via keyboard shortcuts
const MEDIA_URLS = ['youtube.com', 'netflix.com', 'primevideo.com', 'spotify.com',
                    'soundcloud.com', 'twitch.tv', 'vimeo.com', 'hulu.com'];

/**
 * @param {{ type: string, target: string }} resource
 * @returns {{ canOpen, canClick, canType, canScroll, canControlMedia, preferredInterface, isHybrid }}
 */
export default function resolveCapabilities(resource) {
  const target = String(resource.target || '').toLowerCase();
  const type   = String(resource.type   || '').toLowerCase();
  // Apps from the installed-apps catalog have an AppID as target; use their exe / name for the lookups below.
  const exe     = String(resource.exe || '').toLowerCase();
  const display = String(resource.displayName || '').toLowerCase();
  const names   = [target, exe, exe && `${exe}.exe`, display].filter(Boolean);
  const isKnown = (set) => names.some((n) => set.has(n)) || [...set].some((s) => display && display.split(' ').includes(s.replace('.exe', '')));

  const caps = {
    canOpen:          true,
    canClick:         true,
    canType:          true,
    canScroll:        true,
    canControlMedia:  false,
    preferredInterface: 'Vision', // fallback for anything unrecognised
    isHybrid:         false,
  };

  if (type === 'desktop') {
    // Default desktop interface is UIA (accessibility tree)
    caps.preferredInterface = 'UIA';

    if (isKnown(MEDIA_APPS)) {
      caps.canControlMedia = true;
    }

    if (isKnown(HYBRID_APPS)) {
      caps.isHybrid = true;
      // Electron apps expose UIA but also support CDP for their web content
      caps.preferredInterface = 'UIA';
    }

    // UWP apps (AppID contains '!') — UIA but more limited
    if (target.includes('!') || target.startsWith('ms-')) {
      caps.preferredInterface = 'UIA';
    }

    // CLI apps — no visual UI to click
    if (names.some((n) => ['powershell.exe', 'powershell', 'cmd.exe', 'cmd', 'wt.exe', 'windows terminal'].includes(n))) {
      caps.canClick = false;
      caps.preferredInterface = 'UIA';
    }

  } else if (type === 'web') {
    // Default web: DOM via CDP (if available), otherwise UIA/Vision fallback
    caps.preferredInterface = 'DOM';

    if (MEDIA_URLS.some(u => target.includes(u))) {
      caps.canControlMedia = true;
    }

  } else if (type === 'hybrid') {
    caps.isHybrid        = true;
    caps.preferredInterface = 'UIA';
  }

  return caps;
}
