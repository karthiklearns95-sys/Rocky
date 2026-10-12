import { loadDisplays, activeDisplay, toGlobal } from '../automation/system/displays.js';
import { captureRect } from '../automation/system/screenCapture.js';
import getActiveWindow from '../automation/system/getActiveWindow.js';
import getSystemMetrics from '../automation/system/getSystemMetrics.js';

/**
 * Pictures of one monitor for the vision model, and the way back from the model's answer.
 *
 * A vision model answers in the picture's own coordinates (pixels, 0-1 or 0-1000). Rocky clicks in
 * virtual-desktop pixels. On a second monitor those differ by the monitor's origin (which can be
 * negative), so every answer goes through mapModelPoint before it is clicked.
 */

/** The display Grace is working on (foreground window), plus all displays. */
export async function pickDisplay({ display = null, activeWindow = undefined } = {}) {
  const displays = await loadDisplays({ fallback: getSystemMetrics }).catch(() => null);
  if (!displays?.length) return { display: display, displays: display ? [display] : [] };
  if (display) return { display, displays };
  const win = activeWindow !== undefined ? activeWindow : await getActiveWindow().catch(() => null);
  return { display: activeDisplay(displays, { activeWindow: win }), displays };
}

/** Capture a display as { display, base64, png, width, height }. Throws when it cannot. */
export async function captureForVision(display, { worker, fallback } = {}) {
  try {
    const shot = await captureRect(display, worker ? { worker } : {});
    return { display, png: shot.png, base64: shot.png.toString('base64'), width: shot.width, height: shot.height };
  } catch (err) {
    if (!display.primary) throw err;
    const png = await (fallback || (async () => (await import('screenshot-desktop')).default({ format: 'png' })))();
    return { display, png, base64: png.toString('base64'), width: display.width, height: display.height };
  }
}

/**
 * Turn a point the model gave into virtual-desktop pixels. `space`:
 *   'auto'     0-1 means a fraction of the picture, anything else is picture pixels
 *   'thousand' 0-1000 across the picture
 *   'pixels'   picture pixels
 * Returns null when the point is missing or lands outside the monitor.
 */
export function mapModelPoint(point, display, image = null, { space = 'auto' } = {}) {
  const x = Number(point?.x), y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  const w = image?.width || display.width, h = image?.height || display.height;
  let px, py;
  if (space === 'thousand') { px = (x / 1000) * w; py = (y / 1000) * h; }
  else if (space === 'auto' && x <= 1 && y <= 1) { px = x * w; py = y * h; }
  else { px = x; py = y; }
  // The picture may be scaled relative to the monitor; convert picture pixels to screen pixels.
  const local = { x: Math.round(px * (display.width / w)), y: Math.round(py * (display.height / h)) };
  if (local.x >= display.width || local.y >= display.height) return null;
  return toGlobal(display, local);
}
