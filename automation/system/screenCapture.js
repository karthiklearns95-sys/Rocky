import { tryWorker } from './psWorker.js';
import { decodePng, isPng } from './png.js';

/**
 * Screen capture for one display (or any rectangle) of the virtual desktop.
 *
 * The persistent PowerShell worker copies the rectangle straight from the screen in physical
 * pixels, so the frame lines up exactly with the coordinates UI Automation, OCR and the mouse use.
 * When the worker cannot do it, a PRIMARY display falls back to screenshot-desktop; a secondary
 * display has no safe fallback and throws (callers treat that as "could not look").
 */

/** Capture `rect` ({x, y, width, height}). Returns { x, y, width, height, png: Buffer }. */
export async function captureRect(rect, { worker = tryWorker, timeoutMs = 8000 } = {}) {
  const res = await worker('capture', { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, { timeoutMs });
  if (!res.ok || !res.result?.png) throw new Error(res.error || 'worker could not capture the screen');
  const png = Buffer.from(res.result.png, 'base64');
  if (!isPng(png)) throw new Error('screen capture did not return a PNG');
  return { x: res.result.x, y: res.result.y, width: res.result.width, height: res.result.height, png };
}

/**
 * Capture and decode a display. Returns { width, height, data } (RGBA) plus the display's origin
 * as `origin`, so a point in the frame maps back to the screen with toGlobal(origin, p).
 */
export async function captureDisplayFrame(display, { worker = tryWorker, fallback = null } = {}) {
  try {
    const shot = await captureRect(display, { worker });
    const frame = decodePng(shot.png);
    return { ...frame, origin: { x: shot.x, y: shot.y } };
  } catch (err) {
    if (!display.primary || !fallback) throw err;
    const buf = await fallback();
    if (!isPng(buf)) throw new Error('screen capture did not return a PNG');
    return { ...decodePng(buf), origin: { x: display.x, y: display.y } };
  }
}
