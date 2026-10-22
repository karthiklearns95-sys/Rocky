// Calibration for multi-monitor support. Run on the Windows laptop:   node scripts/check_displays.mjs
//
// Shows what the PowerShell worker sees (monitors, DPI mode), then puts the pointer in the middle of
// each monitor the way Rocky does before a click and reads it back. If they agree (within 1 px),
// clicks, screen capture, OCR and UI Automation all share one coordinate space.
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
try { nut = await import('@nut-tree-fork/nut-js'); } catch (e) { console.warn('\nnut.js not available:', e.message); }
const { movePointer } = await import('../automation/system/pointer.js');

let bad = 0;
const saved = await tryWorker('cursor');
console.log("\nPointer (Rocky's way: the DPI-aware worker places it, nut.js only clicks):");
for (const d of displays) {
  const want = { x: d.x + Math.round(d.width / 2), y: d.y + Math.round(d.height / 2) };
  const moved = await movePointer(want.x, want.y, { nutMove: nut ? (x, y) => nut.mouse.setPosition(new nut.Point(x, y)) : null });
  await new Promise((r) => setTimeout(r, 150));
  const got = (await tryWorker('cursor')).result;
  const ok = moved.via === 'worker' && Math.abs(got.x - want.x) <= 1 && Math.abs(got.y - want.y) <= 1;
  if (!ok) bad++;
  // What nut.js believes the position is shows the Windows scaling Rocky now sidesteps.
  let seen = '';
  if (nut) {
    const p = await nut.mouse.getPosition();
    const sx = p.x ? (got.x / p.x) : 1, sy = p.y ? (got.y / p.y) : 1;
    seen = `; nut.js sees (${p.x}, ${p.y})${Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02 ? `, i.e. Windows scaling x${sx.toFixed(2)} (no longer affects Rocky)` : ''}`;
  }
  console.log(`  #${d.index + 1}: asked (${want.x}, ${want.y}), pointer at (${got.x}, ${got.y}) via ${moved.via}  ${ok ? 'OK' : 'OFF'}${seen}`);
}
if (saved.ok) await movePointer(saved.result.x, saved.result.y);

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
