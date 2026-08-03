import path from 'path';
import fs from 'fs';

/**
 * VisionHandler - High-Precision Vision System.
 * Implements Zoom + Retry loop for UI element detection.
 *
 * Screenshot capture uses screenshot-desktop (no clipboard side-effects).
 * Screen dimensions are queried at runtime — no hardcoded 1920×1080.
 */
export default class VisionHandler {
  constructor(aiProvider, toolManager) {
    this.aiProvider = aiProvider;
    this.toolManager = toolManager;
    this._screenDims = null; // cached after first query
  }

  async analyze(prompt, imageBase64, modelName = 'llava') {
    if (!this.aiProvider || typeof this.aiProvider.generateVision !== 'function') {
      throw new Error('Vision provider is not available for UI analysis.');
    }

    return this.aiProvider.generateVision(prompt, imageBase64, modelName);
  }

  async detectWithRetry(task, attempts = 2) {
    console.log(`[VisionHandler] Starting high-precision detection for: "${task}"`);
    let region = null; // null means full screen

    for (let i = 0; i < attempts; i++) {
      console.log(`[VisionHandler] Attempt ${i + 1}/${attempts}...`);

      // 1. Take Screenshot (Full or Zoomed)
      const screenshotPath = await this._captureScreenshot(region);
      if (!screenshotPath) {
        console.error('[VisionHandler] Screenshot capture failed — aborting detection.');
        break;
      }
      const base64 = fs.readFileSync(screenshotPath, { encoding: 'base64' });
      // Clean up immediately after reading
      try { if (fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath); } catch (_) {}

      // 2. LLaVA Analysis
      const result = await this.aiProvider.generateVision(
        `Task: ${task}. Return JSON with { "x": number, "y": number, "confidence": number }. Use screen coordinates 0-1000.`,
        base64,
        'llava'
      );

      console.log(`[VisionHandler] LLaVA Result:`, result);

      // 3. Validation — sanity-check that confidence is actually a number
      if (result && typeof result.confidence === 'number' && result.confidence > 0.7) {
        console.log(`[VisionHandler] ✅ High confidence match found!`);
        result.x += (Math.random() * 6 - 3);
        result.y += (Math.random() * 6 - 3);
        return result;
      }

      // 4. Zoom Logic
      if (result && result.x !== undefined && i < attempts - 1) {
        console.log(`[VisionHandler] 🔍 Low confidence. Zooming into suspected area...`);
        const dims = await this._getScreenDimensions();
        region = this._calculateZoomRegion(result.x, result.y, dims);
      } else {
        break;
      }
    }

    return { error: 'low_confidence', message: 'Rocky is unsure of the button location.' };
  }

  /**
   * Capture a screenshot using screenshot-desktop (no clipboard involvement).
   * Falls back to PowerShell CopyFromScreen as a last resort.
   * @param {Object|null} region - Optional { x, y, w, h } crop region.
   * @returns {Promise<string|null>} Absolute path to the saved PNG, or null on failure.
   */
  async _captureScreenshot(region) {
    const tempDir = process.env.TEMP || path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp');
    const tempPath = path.join(tempDir, `rocky_vision_${Date.now()}.png`);

    try {
      // Primary: screenshot-desktop — no clipboard, no SendKeys, no side-effects
      const screenshot = (await import('screenshot-desktop')).default;
      await screenshot({ filename: tempPath });
    } catch (err) {
      console.warn('[VisionHandler] screenshot-desktop failed, trying PowerShell CopyFromScreen:', err.message);
      const { execWithTimeout } = await import('../../automation/system/execWithTimeout.js');
      const psCapture = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen; $b = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($s.Bounds.X, $s.Bounds.Y, 0, 0, $s.Bounds.Size); $b.Save('${tempPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose();"`;
      const { timedOut, error } = await execWithTimeout(psCapture, { timeoutMs: 10000 });
      if (timedOut || error) {
        console.error('[VisionHandler] Both screenshot methods failed.');
        return null;
      }
    }

    if (!fs.existsSync(tempPath)) return null;

    if (region) {
      return await this._cropImage(tempPath, region);
    }

    return tempPath;
  }

  /**
   * Crop an existing PNG to a sub-region using PowerShell System.Drawing.
   */
  async _cropImage(sourcePath, region) {
    const { execWithTimeout } = await import('../../automation/system/execWithTimeout.js');
    const zoomedPath = sourcePath.replace('.png', '_zoomed.png');
    const safeSource = sourcePath.replace(/'/g, "''");
    const safeZoomed = zoomedPath.replace(/'/g, "''");
    const cropCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${safeSource}'); $rect = New-Object System.Drawing.Rectangle(${region.x}, ${region.y}, ${region.w}, ${region.h}); $bmp = New-Object System.Drawing.Bitmap(${region.w}, ${region.h}); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, ${region.w}, ${region.h})), $rect, [System.Drawing.GraphicsUnit]::Pixel); $bmp.Save('${safeZoomed}'); $img.Dispose(); $bmp.Dispose(); $g.Dispose();"`;
    const { timedOut, error } = await execWithTimeout(cropCmd, { timeoutMs: 10000 });
    try { if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath); } catch (_) {}
    if (timedOut || error) return null;
    return fs.existsSync(zoomedPath) ? zoomedPath : null;
  }

  /**
   * Queries real screen dimensions at runtime.
   * Cached after first successful call — no repeated PowerShell for the same session.
   */
  async _getScreenDimensions() {
    if (this._screenDims) return this._screenDims;
    const { execWithTimeout } = await import('../../automation/system/execWithTimeout.js');
    const { stdout } = await execWithTimeout(
      `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height"`,
      { timeoutMs: 5000 }
    );
    const lines = (stdout || '').trim().split('\n').map(Number).filter(n => n > 0);
    this._screenDims = lines.length >= 2
      ? { width: lines[0], height: lines[1] }
      : { width: 1920, height: 1080 }; // safe fallback only if PowerShell itself fails
    return this._screenDims;
  }

  _calculateZoomRegion(xPercent, yPercent, dims = { width: 1920, height: 1080 }) {
    // Convert 0-1000 coordinates to real pixels using live screen dimensions
    const centerX = (xPercent / 1000) * dims.width;
    const centerY = (yPercent / 1000) * dims.height;
    const width = 400;
    const height = 400;
    return {
      x: Math.max(0, Math.round(centerX - width / 2)),
      y: Math.max(0, Math.round(centerY - height / 2)),
      w: width,
      h: height,
    };
  }
}
