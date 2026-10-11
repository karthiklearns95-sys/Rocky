import { execWithTimeout } from './execWithTimeout.js';
import { tryWorker } from './psWorker.js';

// Screen size almost never changes while Rocky runs; remember it for a while.
let cached = null;
const CACHE_MS = 30000;

/**
 * Gets primary screen resolution via Windows Forms.
 *
 * Fixed: replaced bare exec() with execWithTimeout (4s deadline).
 * Fixed: fallback is now null instead of hardcoded 1920x1080 — callers must
 * handle null explicitly rather than silently receiving wrong dimensions on
 * 4K, 1440p, or multi-monitor setups.
 */
export default async function getSystemMetrics() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const fast = await tryWorker('screen', {}, { timeoutMs: 3000 });
  if (fast.ok && fast.result?.width > 0 && fast.result?.height > 0) {
    cached = { at: Date.now(), value: { width: fast.result.width, height: fast.result.height } };
    return cached.value;
  }

  const { stdout, timedOut, error } = await execWithTimeout(
    `powershell -NoProfile -Command ` +
    `"Add-Type -AssemblyName System.Windows.Forms; ` +
    `[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width; ` +
    `[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height"`,
    { timeoutMs: 4000 }
  );

  if (timedOut || error || !stdout) {
    console.warn('[getSystemMetrics] PS query failed or timed out — returning null. Caller must handle this.');
    return null; // Do NOT fall back to 1920x1080: that silently corrupts coords on non-1080p screens.
  }

  const [width, height] = stdout.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    console.warn(`[getSystemMetrics] Unexpected output: "${stdout.trim()}" — returning null.`);
    return null;
  }

  cached = { at: Date.now(), value: { width, height } };
  return cached.value;
}
