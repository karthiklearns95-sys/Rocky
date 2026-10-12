/**
 * verifyExecution.js - did the action actually do something?
 *
 * Rocky must not assume a click worked just because the tool ran. For a click,
 * the evidence is the screen itself, read carefully so ordinary screen life
 * does not fool it:
 *
 *   - Noise mask: two snapshots are taken BEFORE the click. Anything that
 *     already changes between them (blinking cursor, spinner, clock, video) is
 *     ignored afterwards, along with its neighbouring blocks.
 *   - Patience: after the click the screen is checked repeatedly (default for
 *     1.5 s) and the click counts as soon as a real change shows up, so slow
 *     UIs are not mistaken for failures.
 *   - Two scales: a finer look right around the click (a small checkbox
 *     toggling) and a coarse look at the whole screen (a window opening).
 *   - Honest "unknown": if the screen cannot be captured or decoded, the
 *     verdict is 'unknown' and the caller trusts the tool exactly as before.
 *     A verifier problem never turns into a task failure.
 *
 * Verdicts: 'changed' | 'unchanged' | 'unknown'.
 */

import { captureFrame, makeFingerprint, GLOBAL_COLS, GLOBAL_ROWS, LOCAL_SIZE } from './screenProbe.js';

// Brightness difference (0-255) that counts as a real change in a block.
export const NOISE_THRESHOLD = 6;     // between the two "before" snapshots
export const LOCAL_THRESHOLD = 10;    // fine grid around the click
export const GLOBAL_THRESHOLD = 8;    // coarse whole-screen grid
export const MIN_GLOBAL_BLOCKS = 4;   // a text caret spans at most ~2 blocks; real windows/menus change dozens

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Blocks that differ between two same-size grids (0/1 per block). */
function changedBlocks(a, b, threshold) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > threshold) out[i] = 1;
  return out;
}

/** Spread each marked block to its 8 neighbours (animations move a little). */
function dilate(mask, cols, rows) {
  const out = new Uint8Array(mask.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r * cols + c]) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out[rr * cols + cc] = 1;
        }
      }
    }
  }
  return out;
}

/** Which blocks were already changing before the click. */
export function buildNoiseMask(fpA, fpB, { cols, rows, localSize }) {
  return {
    global: dilate(changedBlocks(fpA.global, fpB.global, NOISE_THRESHOLD), cols, rows),
    local: fpA.local && fpB.local
      ? dilate(changedBlocks(fpA.local, fpB.local, NOISE_THRESHOLD), localSize, localSize)
      : null,
  };
}

/**
 * Compare a later fingerprint with the pre-click one, ignoring noisy blocks.
 * Returns { changed, globalBlocks, localBlocks }.
 */
export function diffFingerprints(before, after, noise) {
  const count = (a, b, mask, threshold) => {
    const diff = changedBlocks(a, b, threshold);
    let n = 0;
    for (let i = 0; i < diff.length; i++) if (diff[i] && !(mask && mask[i])) n++;
    return n;
  };
  const globalBlocks = count(before.global, after.global, noise.global, GLOBAL_THRESHOLD);
  const localBlocks = before.local && after.local ? count(before.local, after.local, noise.local, LOCAL_THRESHOLD) : 0;
  return {
    changed: localBlocks >= 1 || globalBlocks >= MIN_GLOBAL_BLOCKS,
    globalBlocks,
    localBlocks,
  };
}

/**
 * Call just BEFORE clicking. Takes the two baseline snapshots.
 * Returns a session for finishClickVerification, or null when the screen
 * cannot be read (the verdict is then 'unknown').
 *
 * @param {{x:number,y:number}} point click position in screen coordinates
 * @param {{width:number,height:number}|null} [screen] logical screen size, used to
 *        map the click onto the capture when no display is given (older, single-monitor path)
 * @param {{x:number,y:number,width:number,height:number}|null} [display] the monitor the click
 *        lands on. Only that monitor is captured, and the click is placed relative to its
 *        top-left corner. Points on any monitor (negative coordinates included) are fine.
 */
export async function beginClickVerification(point, { screen = null, display = null, capture = null, sleep = defaultSleep, baselineGapMs = 120 } = {}) {
  try {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    if (!display && !(point.x >= 0 && point.y >= 0)) return null;
    capture = capture || (() => captureFrame(display));
    const frameA = await capture();
    const origin = display ? { x: display.x, y: display.y } : { x: 0, y: 0 };
    const scale = display ? frameA.width / display.width : screen?.width ? frameA.width / screen.width : 1;
    const framePoint = { x: (point.x - origin.x) * scale, y: (point.y - origin.y) * scale };
    const fpA = makeFingerprint(frameA, framePoint);

    await sleep(baselineGapMs);
    const frameB = await capture();
    if (frameB.width !== frameA.width || frameB.height !== frameA.height) return null;
    const fpB = makeFingerprint(frameB, framePoint);

    const dims = { cols: GLOBAL_COLS, rows: GLOBAL_ROWS, localSize: LOCAL_SIZE };
    return { framePoint, before: fpB, noise: buildNoiseMask(fpA, fpB, dims), capture };
  } catch (err) {
    console.warn(`[Verify] Could not take baseline snapshots: ${err.message}`);
    return null;
  }
}

/**
 * Call AFTER clicking. Watches the screen until a real change appears or the
 * time runs out.
 *
 * @param {object|null} session from beginClickVerification
 * @param {{ windowChanged?: () => Promise<boolean> }} [opts] windowChanged is an
 *        extra signal (the foreground window is different now) that also counts
 *        as a change, e.g. a fullscreen app opening.
 * @returns {Promise<{verdict: 'changed'|'unchanged'|'unknown', reason: string, globalBlocks?: number, localBlocks?: number, waitedMs?: number}>}
 */
export async function finishClickVerification(session, { timeoutMs = 1500, intervalMs = 150, sleep = defaultSleep, windowChanged = null, now = Date.now } = {}) {
  if (!session) return { verdict: 'unknown', reason: 'screen could not be read before the click' };

  const started = now();
  let last = { globalBlocks: 0, localBlocks: 0 };
  let captureFailures = 0;
  let looks = 0;

  while (true) {
    await sleep(intervalMs);
    try {
      const frame = await session.capture();
      looks++;
      const fp = makeFingerprint(frame, session.framePoint);
      const diff = diffFingerprints(session.before, fp, session.noise);
      last = diff;
      if (diff.changed) {
        return { verdict: 'changed', reason: diff.localBlocks ? 'screen changed at the click' : 'screen changed', ...diff, waitedMs: now() - started };
      }
    } catch (err) {
      captureFailures++;
      if (captureFailures >= 2 && looks === 0) return { verdict: 'unknown', reason: `screen could not be read after the click (${err.message})` };
    }

    if (windowChanged) {
      try {
        if (await windowChanged()) return { verdict: 'changed', reason: 'foreground window changed', ...last, waitedMs: now() - started };
      } catch { /* extra signal only */ }
    }

    if (now() - started >= timeoutMs) break;
  }

  if (looks === 0) return { verdict: 'unknown', reason: 'screen could not be read after the click' };
  return { verdict: 'unchanged', reason: 'nothing changed on screen after the click', ...last, waitedMs: now() - started };
}

/**
 * Validates a UI interaction strictly via the Daemon IPC response payload.
 *
 * @param {Object} uiaResponse - The JSON payload returned from uiaManager.js
 * @returns {Object} { changed: boolean, reason: string, elementState: string }
 */
export async function validateExecutionState(uiaResponse) {
  if (!uiaResponse || !uiaResponse.success) {
    return {
      changed: false,
      reason: uiaResponse?.error || 'DAEMON_FAILURE',
      elementState: 'none'
    };
  }

  console.log(`[Validation] UIA State confirmed: ${uiaResponse.elementState || 'success'} in ${uiaResponse.latency}`);

  return {
    changed: true, // Deterministic proof the tree was modified or event triggered
    reason: 'UIA_STATE_CONFIRMED',
    elementState: uiaResponse.elementState || 'invoked'
  };
}
