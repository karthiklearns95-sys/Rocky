import { tryWorker } from './psWorker.js';

/**
 * Put the mouse pointer on a point, in the coordinates the rest of Rocky uses: physical pixels of
 * the virtual desktop (what UI Automation, OCR and screen capture report).
 *
 * nut.js cannot be trusted with the position on Windows: under plain Node (not DPI aware) Windows
 * scales its coordinates, so on a 125 % display every position came out 1.25x too far from the
 * top-left corner (found by scripts/check_displays.mjs on a real laptop). The DPI-aware PowerShell
 * worker moves the pointer instead; nut.js still does the click itself, which happens wherever the
 * pointer is and needs no coordinates.
 *
 * @returns {Promise<{ ok: boolean, via: 'worker'|'nut', at?: {x:number,y:number}, error?: string }>}
 */
export async function movePointer(x, y, { worker = tryWorker, nutMove = null, platform = process.platform, warn = console.warn } = {}) {
  const px = Math.round(Number(x)), py = Math.round(Number(y));
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { ok: false, via: 'none', error: 'bad coordinates' };

  if (platform === 'win32') {
    const r = await worker('move', { x: px, y: py }, { timeoutMs: 3000 });
    if (r.ok) {
      const at = r.result;
      // Windows may clamp a point that is off every monitor; anything else means it really moved there.
      const off = Math.abs(at.x - px) + Math.abs(at.y - py);
      if (off > 2) warn(`[Pointer] Asked for (${px}, ${py}), the pointer is at (${at.x}, ${at.y}).`);
      return { ok: off <= 2, via: 'worker', at, ...(off > 2 ? { error: `pointer ended up at (${at.x}, ${at.y})` } : {}) };
    }
    if (!movePointer.warned) {
      movePointer.warned = true;
      warn(`[Pointer] The PowerShell worker could not move the pointer (${r.error}); using nut.js, whose positions are off on scaled displays.`);
    }
  }
  if (!nutMove) return { ok: false, via: 'none', error: 'no way to move the pointer' };
  await nutMove(px, py);
  return { ok: true, via: 'nut' };
}
