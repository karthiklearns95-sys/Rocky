// Calibration for multi-monitor support. Run on the Windows laptop:   node scripts/check_displays.mjs
//
// Shows what the PowerShell worker sees (monitors, DPI mode), then moves the mouse to the middle of
// each monitor with nut.js and reads the cursor position back through the worker. If the two agree
// (within 1 px) clicks, screen capture, OCR and UI Automation all share one coordinate space.
// NOTE: this moves your mouse pointer for a second.
import { loadDisplays } from '../automation/system/displays.js';
import { tryWorker } from '../automation/system/psWorker.js';
import { captureRect } from '../automation/system/screenCapture.js';

const ping = await tryWorker('ping', {}, { timeoutMs: 15000 });
if (!ping.ok) { console.error('Worker not available:', ping.error || 'unknown'); process.exit(2); }
console.log(`Worker: PowerShell ${ping.result.ps}, DPI awareness: ${ping.result.dpi}`);
if (ping.result.dpi === 'none') console.warn('  ! The worker is not DPI aware: coordinates on scaled monitors will be wrong.');

const displays = await loadDisplays({ fresh: true });
if (!displays?.length) { console.error('No displays reported.'); process.exit(2); }
console.log(`\n${displays.length} monitor(s):`);
for (const d of displays) {
  console.log(`  #${d.index + 1} ${d.name}${d.primary ? ' (primary)' : ''}  ${d.width}x${d.height} at (${d.x}, ${d.y})`);
}

let nut;
try { nut = await import('@nut-tree-fork/nut-js'); } catch (e) { console.warn('\nnut.js not available, skipping the pointer test:', e.message); }

let bad = 0;
if (nut) {
  const { mouse, Point } = nut;
  const saved = await tryWorker('cursor');
  console.log('\nPointer round trip (nut.js moves, worker reads):');
  for (const d of displays) {
    const want = { x: d.x + Math.round(d.width / 2), y: d.y + Math.round(d.height / 2) };
    await mouse.setPosition(new Point(want.x, want.y));
    await new Promise((r) => setTimeout(r, 150));
    const got = (await tryWorker('cursor')).result;
    const off = { x: got.x - want.x, y: got.y - want.y };
    const ok = Math.abs(off.x) <= 1 && Math.abs(off.y) <= 1;
    if (!ok) bad++;
    console.log(`  #${d.index + 1}: moved to (${want.x}, ${want.y}), cursor is at (${got.x}, ${got.y})  ${ok ? 'OK' : `OFF by (${off.x}, ${off.y})`}`);
  }
  if (saved.ok) await mouse.setPosition(new Point(saved.result.x, saved.result.y));
}

console.log('\nCapture test:');
for (const d of displays) {
  try {
    const shot = await captureRect(d);
    const ok = shot.width === d.width && shot.height === d.height;
    if (!ok) bad++;
    console.log(`  #${d.index + 1}: ${shot.width}x${shot.height} ${ok ? 'OK' : `MISMATCH (expected ${d.width}x${d.height})`}`);
  } catch (e) { bad++; console.log(`  #${d.index + 1}: FAILED - ${e.message}`); }
}

console.log(bad ? `\n${bad} problem(s). Send this output back so the coordinate model can be corrected.` : '\nAll monitors agree. Multi-monitor coordinates are consistent.');
process.exit(bad ? 1 : 0);
