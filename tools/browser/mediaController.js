import { playwrightManager as defaultManager } from './playwrightManager.js';
import { DomResolver } from './domResolver.js';

/**
 * mediaController.js - control video and audio playing in Rocky's browser.
 *
 * Works on the page's own <video>/<audio> elements over the DevTools connection, so it is exact
 * (seek to a time, set the volume to 30 %) and does not depend on which window has focus, unlike
 * the global media keys. The tab with something playing is found automatically.
 *
 * Browsers refuse a script's play() until the user has interacted with the page. When that happens
 * Rocky presses the page's own play button / the video itself, which counts as a real click.
 */

const ACTIONS = ['play', 'pause', 'toggle', 'seek', 'forward', 'back', 'volume', 'mute', 'unmute', 'speed', 'next', 'previous', 'status'];

/** Runs inside the page. Returns the media elements it can see, in document order. */
function listMediaInPage() {
  return [...document.querySelectorAll('video, audio')].map((el, index) => {
    const r = el.getBoundingClientRect();
    return {
      index, tag: el.tagName.toLowerCase(), paused: el.paused, ended: el.ended,
      currentTime: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : null,
      volume: el.volume, muted: el.muted, rate: el.playbackRate,
      area: Math.round(r.width * r.height), readyState: el.readyState,
    };
  });
}

/** Runs inside the page. Applies one change to element `index`, returns its new state. */
function actInPage({ index, op, value }) {
  const el = document.querySelectorAll('video, audio')[index];
  if (!el) return { error: 'gone' };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finish = () => ({ paused: el.paused, currentTime: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : null, volume: el.volume, muted: el.muted, rate: el.playbackRate });
  switch (op) {
    case 'pause': el.pause(); break;
    case 'seek': {
      const end = Number.isFinite(el.duration) ? el.duration : Infinity;
      el.currentTime = clamp(value, 0, end === Infinity ? value : Math.max(0, end - 0.05));
      break;
    }
    case 'volume': el.volume = clamp(value, 0, 1); if (value > 0) el.muted = false; break;
    case 'mute': el.muted = true; break;
    case 'unmute': el.muted = false; break;
    case 'speed': el.playbackRate = clamp(value, 0.25, 4); break;
    case 'play': return el.play().then(() => ({ ok: true, ...finish() }), (e) => ({ blocked: e.name, ...finish() }));
    default: return { error: `unknown op ${op}` };
  }
  return { ok: true, ...finish() };
}

/** Every media element in every frame of the page. */
export async function inspectPage(page) {
  const found = [];
  for (const [f, frame] of page.frames().entries()) {
    try {
      for (const m of await frame.evaluate(listMediaInPage)) found.push({ ...m, frame, frameIndex: f });
    } catch { /* frame navigated away */ }
  }
  return found;
}

/** The element the user most likely means: playing > has a picture > longest. */
export function pickMedia(items) {
  if (!items.length) return null;
  const score = (m) => (m.paused ? 0 : 1000000) + (m.tag === 'video' ? 100000 : 0) + Math.min(m.area, 99999) + Math.min(m.duration || 0, 1000) / 1000;
  return [...items].sort((a, b) => score(b) - score(a))[0];
}

// The last tab Rocky controlled, per browser connection: "pause" then "next" means the same player
// even though nothing is playing by then and Rocky may be looking at another tab.
const lastControlled = new WeakMap();

/** Give a freshly loaded media element a moment to learn its length. */
async function withMetadata(media, page) {
  if (media.duration !== null || media.readyState > 0) return media;
  const end = Date.now() + 1500;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    const again = (await inspectPage(page)).find((m) => m.frameIndex === media.frameIndex && m.index === media.index);
    if (again?.duration !== null && again?.readyState > 0) return again;
  }
  return media;
}

/** The tab to control: the one Rocky is on if it has media, else any tab where something is playing. */
export async function findMediaTarget(manager) {
  const active = await manager.getActivePage();
  const tabs = await manager.listTabs();
  const here = pickMedia(await inspectPage(active));
  if (here && (!here.paused || here.currentTime > 0 || tabs.length < 2)) return { page: active, media: here };
  for (const tab of tabs) {
    if (tab.page === active) continue;
    const m = pickMedia(await inspectPage(tab.page));
    if (m && !m.paused) return { page: tab.page, media: m, switched: true };
  }
  // Nothing is playing: the player Rocky last controlled, if its tab is still open.
  const last = lastControlled.get(manager);
  if (last && !last.isClosed() && last !== active && tabs.some((t) => t.page === last)) {
    const m = pickMedia(await inspectPage(last));
    if (m) return { page: last, media: m, switched: true };
  }
  return here ? { page: active, media: here } : null;
}

const mmss = (s) => {
  if (!Number.isFinite(s)) return '?';
  const t = Math.floor(s);             // players show whole seconds, rounded down
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const describe = (state, title) =>
  `${title ? `"${title}" ` : ''}${state.paused ? 'paused' : 'playing'} at ${mmss(state.currentTime)}${state.duration ? ` of ${mmss(state.duration)}` : ''}, volume ${Math.round(state.volume * 100)}%${state.muted ? ' (muted)' : ''}${state.rate !== 1 ? `, speed ${state.rate}x` : ''}`;

/** "1:30", "90", "1h2m3s" -> seconds, or null. */
export function parseTime(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/))) return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  if ((m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/)) && (m[1] || m[2] || m[3])) {
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  }
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** "30", "30%", 0.3 -> 0..1 (a bare number above 1 is a percentage). */
export function parseVolume(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace('%', ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(1, n > 1 || /%/.test(String(v)) ? n / 100 : n);
}

/**
 * browserMedia: { action, value? }
 *   play | pause | toggle | status | mute | unmute | next | previous
 *   seek value=time ("1:30", "90")   forward/back value=seconds (default 10)
 *   volume value=percent   speed value=1.5
 */
export async function browserMedia(args = {}, manager = defaultManager) {
  const { _signal } = args;
  const action = String(args.action || 'toggle').toLowerCase();
  if (!ACTIONS.includes(action)) return { success: false, error: `Unknown media action "${args.action}". Use: ${ACTIONS.join(', ')}.` };
  if (_signal?.aborted) return { success: false, error: 'Aborted' };

  try {
    let target = await findMediaTarget(manager);
    if (target) {
      target = { ...target, media: await withMetadata(target.media, target.page) };
      lastControlled.set(manager, target.page);
    }
    const title = target ? await target.page.title().catch(() => '') : '';

    if (action === 'next' || action === 'previous') return await skipTrack(action, target, manager);
    if (!target) return { success: false, error: 'There is no video or audio on any open tab.' };
    const { page, media } = target;
    if (target.switched) await page.bringToFront().catch(() => {});
    const run = (op, value) => media.frame.evaluate(actInPage, { index: media.index, op, value });

    let state;
    if (action === 'status') {
      return { success: true, data: describe(media, title) };
    } else if (action === 'toggle') {
      return browserMedia({ ...args, action: media.paused ? 'play' : 'pause' }, manager);
    } else if (action === 'play') {
      state = await run('play');
      if (state.blocked) {
        // The browser wants a real click first: press the page's own play button, else the video.
        const btn = await new DomResolver(page).resolve('Play', 'button', { timeoutMs: 800 });
        if (btn) await btn.click({ timeout: 3000 });
        else await media.frame.locator('video, audio').nth(media.index).click({ timeout: 3000, force: true });
        await new Promise((r) => setTimeout(r, 300));
        state = await run('play');
        if (state.blocked) return { success: false, error: `The page would not start playback (${state.blocked}).` };
      }
    } else if (action === 'pause') {
      state = await run('pause');
    } else if (action === 'seek' || action === 'forward' || action === 'back') {
      let to;
      if (action === 'seek') {
        to = parseTime(args.value);
        if (to === null) return { success: false, error: `"${args.value}" is not a time Rocky understands (try 1:30 or 90).` };
      } else {
        const secs = parseTime(args.value ?? 10);
        if (secs === null) return { success: false, error: `"${args.value}" is not an amount of time.` };
        to = media.currentTime + (action === 'forward' ? secs : -secs);
      }
      state = await run('seek', Math.max(0, to));
    } else if (action === 'volume') {
      const v = parseVolume(args.value);
      if (v === null) return { success: false, error: `"${args.value}" is not a volume (try 30 or 30%).` };
      state = await run('volume', v);
    } else if (action === 'speed') {
      const r = Number(String(args.value ?? '').replace(/x$/i, ''));
      if (!Number.isFinite(r) || r <= 0) return { success: false, error: `"${args.value}" is not a speed (try 1.5).` };
      state = await run('speed', r);
    } else {
      state = await run(action);          // mute | unmute
    }
    if (state.error) return { success: false, error: 'That video went away before Rocky could reach it.' };
    return { success: true, data: `Done: ${describe(state, title)}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** Next / previous track: the player's own button, else the usual shortcut (Shift+N / Shift+P). */
async function skipTrack(action, target, manager) {
  const page = target?.page || await manager.getActivePage();
  const label = action === 'next' ? 'Next' : 'Previous';
  const btn = await new DomResolver(page).resolve(label, 'button', { timeoutMs: 800 });
  if (btn) {
    await btn.click({ timeout: 3000 });
    return { success: true, data: `Pressed "${label}".` };
  }
  await page.keyboard.press(action === 'next' ? 'Shift+N' : 'Shift+P');
  return { success: true, data: `Sent ${label} (Shift+${action === 'next' ? 'N' : 'P'}); the page may not support it.` };
}
