import { decodePng, isPng } from '../../automation/system/png.js';

/**
 * Screen probe: look at the screen cheaply, as small grids of brightness.
 *
 * A full-resolution comparison is slow and mostly noise (cursor blink, clock,
 * video). Two coarse grids are enough to answer "did something change here?":
 *   - global: the whole screen as ~96x54 blocks
 *   - local:  a square around the click point as ~48x48 blocks (finer, so a
 *             small checkbox toggling still shows up)
 */

export const GLOBAL_COLS = 96;
export const GLOBAL_ROWS = 54;
export const LOCAL_SIZE = 48;
export const LOCAL_REGION_PX = 240;

/**
 * Capture the screen (or, given a display from displays.js, that one monitor) and decode it. Returns { width, height, data } (RGBA) or
 * throws. Anything unexpected (JPEG output, no display, decoder limits) is an
 * error the caller treats as "could not look".
 */
export async function captureFrame(display = null) {
  if (display) {
    // One specific monitor, captured in physical pixels by the PowerShell worker.
    const { captureDisplayFrame } = await import('../../automation/system/screenCapture.js');
    return captureDisplayFrame(display, {
      fallback: async () => (await import('screenshot-desktop')).default({ format: 'png' }),
    });
  }
  const screenshot = (await import('screenshot-desktop')).default;
  const buf = await screenshot({ format: 'png' });
  if (!isPng(buf)) throw new Error('screen capture did not return a PNG');
  return decodePng(buf);
}

/** Average brightness of a rectangle of the frame, downscaled to cols x rows. */
function lumaGrid(frame, x0, y0, w, h, cols, rows) {
  const out = new Uint8Array(cols * rows);
  const { width, data } = frame;
  for (let r = 0; r < rows; r++) {
    const ya = y0 + Math.floor((r * h) / rows);
    const yb = Math.max(ya + 1, y0 + Math.floor(((r + 1) * h) / rows));
    for (let c = 0; c < cols; c++) {
      const xa = x0 + Math.floor((c * w) / cols);
      const xb = Math.max(xa + 1, x0 + Math.floor(((c + 1) * w) / cols));
      let sum = 0, n = 0;
      // Sample at most ~8x8 pixels per block: plenty for averaging, and fast on 4K.
      const sy = Math.max(1, Math.floor((yb - ya) / 8));
      const sx = Math.max(1, Math.floor((xb - xa) / 8));
      for (let y = ya; y < yb; y += sy) {
        for (let x = xa; x < xb; x += sx) {
          const i = (y * width + x) * 4;
          sum += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
          n++;
        }
      }
      out[r * cols + c] = n ? Math.round(sum / n) : 0;
    }
  }
  return out;
}

/**
 * Reduce a frame to its fingerprint. `point` ({x, y} in frame pixels) adds the
 * fine local grid around that spot; pass null for the global grid only.
 */
export function makeFingerprint(frame, point = null) {
  const fp = {
    width: frame.width,
    height: frame.height,
    global: lumaGrid(frame, 0, 0, frame.width, frame.height, GLOBAL_COLS, GLOBAL_ROWS),
    local: null,
  };
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    const side = Math.min(LOCAL_REGION_PX, frame.width, frame.height);
    const x0 = Math.max(0, Math.min(frame.width - side, Math.round(point.x - side / 2)));
    const y0 = Math.max(0, Math.min(frame.height - side, Math.round(point.y - side / 2)));
    fp.local = lumaGrid(frame, x0, y0, side, side, LOCAL_SIZE, LOCAL_SIZE);
  }
  return fp;
}
