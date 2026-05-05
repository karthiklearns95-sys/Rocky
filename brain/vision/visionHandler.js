import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * VisionHandler - High-Precision Vision System.
 * Implements Zoom + Retry loop for UI element detection.
 */
export default class VisionHandler {
  constructor(aiProvider, toolManager) {
    this.aiProvider = aiProvider;
    this.toolManager = toolManager;
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
      const base64 = fs.readFileSync(screenshotPath, { encoding: 'base64' });

      // 2. LLaVA Analysis
      const result = await this.aiProvider.generateVision(
        `Task: ${task}. Return JSON with { "x": number, "y": number, "confidence": number }. Use screen coordinates 0-1000.`,
        base64,
        'llava'
      );

      console.log(`[VisionHandler] LLaVA Result:`, result);

      // 3. Validation
      if (result && result.confidence > 0.7) {
        console.log(`[VisionHandler] ✅ High confidence match found!`);
        // Apply small random offset for human-like clicking
        result.x += (Math.random() * 6 - 3);
        result.y += (Math.random() * 6 - 3);
        return result;
      }

      // 4. Zoom Logic (if confidence is low, zoom into the area LLaVA suspected)
      if (result && result.x !== undefined && i < attempts - 1) {
        console.log(`[VisionHandler] 🔍 Low confidence. Zooming into suspected area...`);
        region = this._calculateZoomRegion(result.x, result.y);
      } else {
        break; // No coordinates returned, can't zoom
      }
    }

    return { error: "low_confidence", message: "Rocky is unsure of the button location." };
  }

  async _captureScreenshot(region) {
    const tempPath = path.join(process.env.TEMP || '.', `rocky_vision_${Date.now()}.png`);
    
    // First, take a full screenshot using the existing tool
    const rawResult = await this.toolManager.execute('takeScreenshot', {});
    // Extract the path from the result string (hacky but works for now as toolManager returns strings)
    // Actually, let's assume the toolManager.execute('takeScreenshot') saves to a known temp location 
    // or we modify the tool to return the path.
    // For now, I'll use a direct PowerShell capture for vision to be safe.
    
    const psCapture = `powershell -Command "[Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.SendKeys]::SendWait('{PRTSC}'); Start-Sleep -m 500; $img = [System.Windows.Forms.Clipboard]::GetImage(); $img.Save('${tempPath.replace(/'/g, "''")}')"`;
    
    await new Promise(r => exec(psCapture, r));

    if (region) {
      const zoomedPath = tempPath.replace('.png', '_zoomed.png');
      const cropCmd = `powershell -Command "
        Add-Type -AssemblyName System.Drawing;
        $img = [System.Drawing.Image]::FromFile('${tempPath.replace(/'/g, "''")}');
        $rect = New-Object System.Drawing.Rectangle(${region.x}, ${region.y}, ${region.w}, ${region.h});
        $bmp = New-Object System.Drawing.Bitmap(${region.w}, ${region.h});
        $g = [System.Drawing.Graphics]::FromImage($bmp);
        $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, ${region.w}, ${region.h})), $rect, [System.Drawing.GraphicsUnit]::Pixel);
        $bmp.Save('${zoomedPath.replace(/'/g, "''")}');
        $img.Dispose(); $bmp.Dispose(); $g.Dispose();
      "`;
      await new Promise(r => exec(cropCmd, r));
      return zoomedPath;
    }

    return tempPath;
  }

  _calculateZoomRegion(xPercent, yPercent) {
    // Convert 0-1000 coordinates to rough pixels (assuming 1920x1080 for zoom logic)
    const centerX = (xPercent / 1000) * 1920;
    const centerY = (yPercent / 1000) * 1080;
    const width = 400; // Zoom window size
    const height = 400;
    
    return {
      x: Math.max(0, centerX - width / 2),
      y: Math.max(0, centerY - height / 2),
      w: width,
      h: height
    };
  }
}
