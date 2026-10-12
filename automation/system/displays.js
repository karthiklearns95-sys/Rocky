import { tryWorker } from './psWorker.js';

/**
 * Displays - one coordinate model for every monitor.
 *
 * Everything Rocky clicks, reads or captures is in PHYSICAL PIXELS OF THE VIRTUAL DESKTOP: the one
 * big coordinate space Windows lays all monitors in. The primary display's top-left is (0, 0); a
 * monitor to its left or above has negative coordinates. The PowerShell worker is made DPI-aware so
 * that UI Automation, screen capture and OCR all speak this space natively (an unaware process
 * reports scaled coordinates on a 125-150 % display, so its clicks landed in the wrong place).
 *
 * A display: { index, name, primary, x, y, width, height, work: {x, y, width, height} }
 *
 * The geometry below is pure (no OS calls) so it is fully testable; loadDisplays() asks Windows.
 */

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);

/** Clean up what Windows reported: numbers, sorted left-to-right then top-to-bottom, one primary. */
export function normalizeDisplays(raw) {
  const list = (Array.isArray(raw) ? raw : [])
    .map((d) => ({
      name: String(d?.name ?? ''),
      primary: Boolean(d?.primary),
      x: num(d?.x), y: num(d?.y),
      width: num(d?.width), height: num(d?.height),
      work: {
        x: num(d?.workX, num(d?.x)), y: num(d?.workY, num(d?.y)),
        width: num(d?.workWidth, num(d?.width)), height: num(d?.workHeight, num(d?.height)),
      },
    }))
    .filter((d) => d.width > 0 && d.height > 0);
  list.sort((a, b) => a.x - b.x || a.y - b.y);
  if (list.length && !list.some((d) => d.primary)) {
    (list.find((d) => d.x === 0 && d.y === 0) || list[0]).primary = true;
  }
  return list.map((d, index) => ({ index, ...d }));
}

/** The rectangle that covers all displays (x/y can be negative). null if there are none. */
export function virtualBounds(displays) {
  if (!displays?.length) return null;
  const x0 = Math.min(...displays.map((d) => d.x)), y0 = Math.min(...displays.map((d) => d.y));
  const x1 = Math.max(...displays.map((d) => d.x + d.width)), y1 = Math.max(...displays.map((d) => d.y + d.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export const primaryDisplay = (displays) => displays?.find((d) => d.primary) || displays?.[0] || null;

const contains = (d, p) => p.x >= d.x && p.x < d.x + d.width && p.y >= d.y && p.y < d.y + d.height;

function distanceToRect(d, p) {
  const dx = Math.max(d.x - p.x, 0, p.x - (d.x + d.width - 1));
  const dy = Math.max(d.y - p.y, 0, p.y - (d.y + d.height - 1));
  return Math.hypot(dx, dy);
}

/** The display a point is on; a point in a gap between displays belongs to the nearest one. */
export function displayAt(displays, point) {
  if (!displays?.length || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const inside = displays.find((d) => contains(d, point));
  if (inside) return inside;
  return displays.reduce((best, d) => (distanceToRect(d, point) < distanceToRect(best, point) ? d : best));
}

/** Pull a point inside the nearest display (so a computed target never lands in a gap or off-desktop). */
export function clampToDesktop(displays, point) {
  const d = displayAt(displays, point);
  if (!d) return point;
  return {
    x: Math.min(Math.max(point.x, d.x), d.x + d.width - 1),
    y: Math.min(Math.max(point.y, d.y), d.y + d.height - 1),
  };
}

/** The display a window mostly sits on (largest overlap); a window off every display falls back to its centre. */
export function displayOfRect(displays, rect) {
  if (!displays?.length || !rect) return null;
  let best = null, bestArea = 0;
  for (const d of displays) {
    const w = Math.min(d.x + d.width, rect.x + rect.width) - Math.max(d.x, rect.x);
    const h = Math.min(d.y + d.height, rect.y + rect.height) - Math.max(d.y, rect.y);
    const area = w > 0 && h > 0 ? w * h : 0;
    if (area > bestArea) { best = d; bestArea = area; }
  }
  return best || displayAt(displays, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
}

/** Where is Grace working? The display holding the foreground window, else the one with the cursor, else primary. */
export function activeDisplay(displays, { activeWindow = null, cursor = null } = {}) {
  const b = activeWindow?.bounds;
  if (b && b.width > 0 && b.height > 0 && !activeWindow.isMinimized) {
    const d = displayOfRect(displays, b);
    if (d) return d;
  }
  if (cursor) { const d = displayAt(displays, cursor); if (d) return d; }
  return primaryDisplay(displays);
}

/**
 * The display next to `from` in a direction: 'left' | 'right' | 'up' | 'down' | 'next' | 'previous'
 * (next/previous cycle through the displays left to right). Null if there is nothing that way.
 */
export function neighborDisplay(displays, from, direction) {
  if (!displays?.length || !from) return null;
  const order = [...displays].sort((a, b) => a.x - b.x || a.y - b.y);
  const i = order.findIndex((d) => d.index === from.index);
  if (direction === 'next') return order[(i + 1) % order.length];
  if (direction === 'previous') return order[(i - 1 + order.length) % order.length];

  const cx = (d) => d.x + d.width / 2, cy = (d) => d.y + d.height / 2;
  const axis = direction === 'left' || direction === 'right' ? cx : cy;
  const across = axis === cx ? cy : cx;
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  const candidates = displays
    .filter((d) => d.index !== from.index && (axis(d) - axis(from)) * sign > 0)
    // nearest along the axis; ties broken by staying in line with the starting display
    .sort((a, b) => Math.abs(axis(a) - axis(from)) - Math.abs(axis(b) - axis(from)) || Math.abs(across(a) - across(from)) - Math.abs(across(b) - across(from)));
  return candidates[0] || null;
}

/** Screen point -> point inside a captured image of `display` (or any rect with x, y). */
export const toLocal = (rect, p) => ({ x: p.x - rect.x, y: p.y - rect.y });
/** Point inside a captured image of `rect` -> screen point. */
export const toGlobal = (rect, p) => ({ x: p.x + rect.x, y: p.y + rect.y });

/**
 * A point found in an image of a rect, to a screen point. The image may have been scaled (a capture
 * made by something that was not DPI-aware): `scale` is image pixels per screen pixel.
 */
export function imagePointToScreen(rect, p, scale = 1) {
  return { x: Math.round(rect.x + p.x / scale), y: Math.round(rect.y + p.y / scale) };
}

// ── Asking Windows ────────────────────────────────────────────────────────

let cache = null;
const TTL_MS = 10000;

/**
 * The current displays, from the persistent worker. If it is unavailable, a single display from
 * the primary screen size; null if nothing at all can be read.
 * @param {{ fresh?: boolean }} [opts]
 */
export async function loadDisplays({ fresh = false, worker = tryWorker, fallback = null, now = Date.now } = {}) {
  if (!fresh && cache && now() - cache.at < TTL_MS) return cache.displays;

  let displays = null;
  const fast = await worker('displays', {}, { timeoutMs: 5000 });
  if (fast.ok) displays = normalizeDisplays(fast.result);

  if ((!displays || displays.length === 0) && fallback) {
    const size = await fallback().catch(() => null);
    if (size?.width > 0) displays = normalizeDisplays([{ name: 'primary', primary: true, x: 0, y: 0, width: size.width, height: size.height }]);
  }
  if (!displays || displays.length === 0) return cache?.displays || null;   // keep the last good answer
  cache = { at: now(), displays };
  return displays;
}

export function resetDisplayCache() { cache = null; }
