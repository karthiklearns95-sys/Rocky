import {
  normalizeDisplays, displayAt, displayOfRect, neighborDisplay, primaryDisplay,
} from '../automation/system/displays.js';

/**
 * Where Rocky's overlay window lives when there is more than one monitor.
 *
 * The overlay is one transparent window that covers the work area of ONE monitor; Rocky walks
 * around inside it. To visit another monitor the window hops there (setBounds to that monitor's
 * work area) and Rocky is placed inside it with window-local coordinates.
 *
 * Two coordinate spaces meet here:
 *   - the rest of Rocky (UI Automation, OCR, clicks) speaks PHYSICAL pixels of the virtual desktop;
 *   - Electron's windows and displays speak DIPs (device-independent pixels).
 * screen.screenToDipPoint converts a point from the first to the second on Windows, per monitor.
 *
 * Everything takes the Electron `screen` object as a parameter, so it is testable with a fake.
 */

/** Electron's displays as displays.js displays, in DIP space (name = Electron display id). */
export function electronDisplays(screenApi) {
  const primaryId = screenApi.getPrimaryDisplay?.().id;
  return normalizeDisplays(screenApi.getAllDisplays().map((d) => ({
    name: String(d.id), primary: d.id === primaryId,
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    workX: d.workArea.x, workY: d.workArea.y, workWidth: d.workArea.width, workHeight: d.workArea.height,
  })));
}

const rectOf = (w) => ({ x: w.x, y: w.y, width: w.width, height: w.height });
const toDip = (screenApi, p) => (screenApi.screenToDipPoint ? screenApi.screenToDipPoint({ x: Math.round(p.x), y: Math.round(p.y) }) : p);

/**
 * Decide what a MOVE_AGENT command means for the window.
 * @param {object} screenApi Electron's `screen`
 * @param {{x:number,y:number,width:number,height:number}} windowBounds the overlay window now (DIPs)
 * @param {string|object} command 'top left' | {x, y, anchor?} (physical desktop pixels) | {display: 'next'|'left'|...}
 * @returns {{ bounds: object|null, command: string|object|null, note?: string }}
 *   bounds: new window bounds when the window must hop (else null); command: what to send the
 *   renderer (window-local, flagged `local`), or null when nothing should move.
 */
export function planOverlayMove(screenApi, windowBounds, command) {
  if (typeof command === 'string' || command == null) return { bounds: null, command: command ?? null };

  const displays = electronDisplays(screenApi);
  if (!displays.length) return { bounds: null, command: null, note: 'no displays' };
  const here = displayOfRect(displays, windowBounds) || primaryDisplay(displays);

  if (command.display) {
    const there = neighborDisplay(displays, here, String(command.display));
    if (!there || there.index === here.index) return { bounds: null, command: null, note: displays.length < 2 ? 'only one monitor' : `no monitor to the ${command.display}` };
    return { bounds: rectOf(there.work), command: 'center', note: `monitor ${there.index + 1} of ${displays.length}` };
  }

  const x = Number(command.x), y = Number(command.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { bounds: null, command: null, note: 'bad position' };

  const dip = toDip(screenApi, { x, y });
  const target = displayAt(displays, dip);
  const hop = target && target !== here ? rectOf(target.work) : null;
  const origin = hop || windowBounds;
  return {
    bounds: hop,
    command: { ...command, x: dip.x - origin.x, y: dip.y - origin.y, local: true },
  };
}

/**
 * Bounds that keep the window covering the work area of the monitor it is on. After a monitor is
 * unplugged or changes resolution the window may hang off-screen or be the wrong size; this gives
 * the corrected bounds (null when it is already right). A window on a vanished monitor goes to the
 * primary one.
 */
export function refitBounds(screenApi, windowBounds) {
  const displays = electronDisplays(screenApi);
  if (!displays.length) return null;
  const on = displayOfRect(displays, windowBounds) || primaryDisplay(displays);
  const w = on.work;
  const same = windowBounds.x === w.x && windowBounds.y === w.y && windowBounds.width === w.width && windowBounds.height === w.height;
  return same ? null : rectOf(w);
}

/**
 * Move/resize a BrowserWindow. Windows applies the size of the monitor the window STARTED on when
 * it crosses between monitors of different scale, so the bounds are set twice (the second call
 * lands correctly once the window is on the new monitor).
 */
export function applyBounds(win, bounds) {
  if (!win || win.isDestroyed?.() || !bounds) return;
  win.setBounds(bounds);
  win.setBounds(bounds);
}
