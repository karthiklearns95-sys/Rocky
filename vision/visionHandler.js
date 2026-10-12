import config from '../config/app.config.js';
import { pickDisplay, captureForVision, mapModelPoint } from './screenImage.js';

/**
 * VisionHandler - High-Precision Vision System.
 * Implements Zoom + Retry loop for UI element detection.
 *
 * Pictures come from the PowerShell worker, one monitor at a time, and answers are mapped back
 * to virtual-desktop pixels (see screenImage.js).
 */
export default class VisionHandler {
  constructor(aiProvider, toolManager) {
    this.aiProvider = aiProvider;
    this.toolManager = toolManager;
  }

  async analyze(prompt, imageBase64, modelName = config.models.vision) {
    if (!this.aiProvider || typeof this.aiProvider.generateVision !== 'function') {
      throw new Error('Vision provider is not available for UI analysis.');
    }

    return this.aiProvider.generateVision(prompt, imageBase64, modelName);
  }

  /**
   * Find `task` on the monitor Grace is working on (or `display`). The model answers in 0-1000
   * across the picture; the result is returned in virtual-desktop pixels, ready to click.
   * A low-confidence first answer is zoomed into once.
   */
  async detectWithRetry(task, attempts = 2, { display: wanted = null } = {}) {
    console.log(`[VisionHandler] Starting high-precision detection for: "${task}"`);
    const { display } = await pickDisplay({ display: wanted });
    if (!display) return { error: 'no_screen', message: 'Rocky cannot see any screen.' };

    let crop = null; // null = whole monitor; otherwise { x, y, width, height } in monitor-local pixels

    for (let i = 0; i < attempts; i++) {
      console.log(`[VisionHandler] Attempt ${i + 1}/${attempts}...`);
      let shot;
      try {
        shot = await captureForVision(display);
        if (crop) shot = await cropShot(shot, crop);
      } catch (err) {
        console.error('[VisionHandler] Screenshot capture failed — aborting detection:', err.message);
        break;
      }

      const result = await this.aiProvider.generateVision(
        `Task: ${task}. Return JSON with { "x": number, "y": number, "confidence": number }. Use image coordinates 0-1000.`,
        shot.base64,
        config.models.vision
      );
      console.log(`[VisionHandler] LLaVA Result:`, result);

      // Where in the monitor (local pixels) did the model point?
      const area = crop || { x: 0, y: 0, width: display.width, height: display.height };
      const inArea = mapModelPoint(result, { x: 0, y: 0, width: area.width, height: area.height }, null, { space: 'thousand' });
      const confident = result && typeof result.confidence === 'number' && result.confidence > 0.7;

      if (confident && inArea) {
        console.log(`[VisionHandler] ✅ High confidence match found!`);
        const jitter = () => Math.random() * 6 - 3;
        return { ...result, x: display.x + area.x + inArea.x + jitter(), y: display.y + area.y + inArea.y + jitter() };
      }

      if (inArea && i < attempts - 1) {
        console.log(`[VisionHandler] 🔍 Low confidence. Zooming into suspected area...`);
        crop = zoomRegion(display, { x: area.x + inArea.x, y: area.y + inArea.y });
      } else {
        break;
      }
    }

    return { error: 'low_confidence', message: 'Rocky is unsure of the button location.' };
  }
}

/** A 400x400 square around a monitor-local point, kept inside the monitor. */
export function zoomRegion(display, center, size = 400) {
  const width = Math.min(size, display.width), height = Math.min(size, display.height);
  return {
    x: Math.max(0, Math.min(display.width - width, Math.round(center.x - width / 2))),
    y: Math.max(0, Math.min(display.height - height, Math.round(center.y - height / 2))),
    width, height,
  };
}

/** Crop a captured monitor picture to a monitor-local rectangle. */
async function cropShot(shot, crop) {
  const { decodePng, encodePng } = await import('../automation/system/png.js');
  const img = decodePng(shot.png);
  const out = new Uint8Array(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y++) {
    const src = ((crop.y + y) * img.width + crop.x) * 4;
    out.set(img.data.subarray(src, src + crop.width * 4), y * crop.width * 4);
  }
  const png = encodePng(crop.width, crop.height, out);
  return { ...shot, png, base64: png.toString('base64'), width: crop.width, height: crop.height };
}
