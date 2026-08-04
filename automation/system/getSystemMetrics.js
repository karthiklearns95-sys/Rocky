import { execWithTimeout } from './execWithTimeout.js';

/**
 * Gets primary screen resolution via Windows Forms.
 *
 * Fixed: replaced bare exec() with execWithTimeout (4s deadline).
 * Fixed: fallback is now null instead of hardcoded 1920x1080 — callers must
 * handle null explicitly rather than silently receiving wrong dimensions on
 * 4K, 1440p, or multi-monitor setups.
 */
export default async function getSystemMetrics() {
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

  return { width, height };
}
