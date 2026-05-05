import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import toolManager from '../index.js';
import getUIElements from './getUIElements.js';

/**
 * Visual Perception Tool - Hybrid Intelligence Layer.
 * Priority: 1. UIA Semantic Tree -> 2. Vision Zoom & Retry
 */
export default async function locateUIElement(args, aiProvider) {
  const { description, query } = args;
  const targetDesc = description || query;
  if (!targetDesc) return { error: "No description provided." };

  console.log(`[Tool: locateUIElement] Locating: ${targetDesc}`);

  // Get screen metrics for scaling
  const getSystemMetrics = (await import('../../executor/system/getSystemMetrics.js')).default;
  const metrics = await getSystemMetrics();

  // Helper to scale coordinates if they are normalized (0-1)
  const scaleCoords = (res) => {
    if (!res) return res;
    let { x, y } = res;
    if (x > 0 && x <= 1) x = Math.round(x * metrics.width);
    if (y > 0 && y <= 1) y = Math.round(y * metrics.height);
    return { ...res, x, y };
  };

  // 1. Try Semantic UIA first
  const uiaResult = await getUIElements();
  if (uiaResult.success && uiaResult.elements) {
    const target = uiaResult.elements.find(el => 
      el.Name && el.Name.toLowerCase().includes(targetDesc.toLowerCase())
    );
    if (target && target.BoundingRectangle) {
      try {
        const parts = target.BoundingRectangle.split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
        if (parts.length >= 4) {
          console.log(`[Tool: locateUIElement] Semantic Match Found via UIA:`, target.Name);
          return {
            x: parts[0] + parts[2] / 2,
            y: parts[1] + parts[3] / 2,
            confidence: 1.0,
            label: target.Name,
            source: 'UIA'
          };
        }
      } catch (e) {}
    }
  }

  // 2. Fallback to Hybrid Vision Layer
  const tempDir = process.env.TEMP || path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp');
  const screenshotPath = path.join(tempDir, `vision_full_${Date.now()}.png`);
  
  const captureFullCmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen; $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($screen.Bounds.X, $screen.Bounds.Y, 0, 0, $screen.Bounds.Size); $bitmap.Save('${screenshotPath}', [System.Drawing.Imaging.ImageFormat]::Png); $graphics.Dispose(); $bitmap.Dispose();"`;

  return new Promise((resolve) => {
    exec(captureFullCmd, async (error) => {
      if (error) {
        console.error(`[Tool: locateUIElement] Capture failed:`, error);
        return resolve({ error: "Capture failed" });
      }

      try {
        const imageBase64 = fs.readFileSync(screenshotPath, { encoding: 'base64' });
        
        const visionPrompt = `
          Find the screen coordinates of the center of "${targetDesc}".
          Return ONLY JSON: {"x": number, "y": number, "confidence": number, "label": string}.
          IMPORTANT: Use normalized coordinates (0.0 to 1.0) for x and y.
        `;

        const provider = aiProvider || toolManager.aiProvider;
        let initialResult = await provider.generateVision(visionPrompt, imageBase64, 'llava');
        initialResult = scaleCoords(initialResult);
        console.log(`[Tool: locateUIElement] Initial Vision (Scaled):`, initialResult);

        let finalResult = initialResult;

        // 3. Zoom & Retry
        if (initialResult && initialResult.confidence < 0.7 && initialResult.x > 0) {
          console.log(`[Tool: locateUIElement] Low confidence (${initialResult.confidence}). Zooming in...`);
          
          const cropSize = 300;
          const cropX = Math.max(0, initialResult.x - cropSize / 2);
          const cropY = Math.max(0, initialResult.y - cropSize / 2);
          const cropPath = path.join(tempDir, `vision_crop_${Date.now()}.png`);
          
          const cropCmd = `powershell -Command "Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${screenshotPath}'); $bitmap = New-Object System.Drawing.Bitmap(${cropSize}, ${cropSize}); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $rect = New-Object System.Drawing.Rectangle(${cropX}, ${cropY}, ${cropSize}, ${cropSize}); $graphics.DrawImage($img, 0, 0, $rect, [System.Drawing.GraphicsUnit]::Pixel); $bitmap.Save('${cropPath}', [System.Drawing.Imaging.ImageFormat]::Png); $graphics.Dispose(); $bitmap.Dispose(); $img.Dispose();"`;
          
          await new Promise((res) => exec(cropCmd, res));

          if (fs.existsSync(cropPath)) {
            const cropBase64 = fs.readFileSync(cropPath, { encoding: 'base64' });
            const retryPrompt = `
              This is a zoomed-in crop. Find the exact center of "${targetDesc}".
              Return ONLY JSON: {"x": number, "y": number, "confidence": number, "label": string}.
              Use normalized coordinates relative to THIS CROP (0.0 to 1.0).
            `;
            let retryResult = await provider.generateVision(retryPrompt, cropBase64, 'llava');
            
            if (retryResult && retryResult.x >= 0) {
              // Scale crop-relative normalized to absolute
              const scaledRetryX = cropX + (retryResult.x * cropSize);
              const scaledRetryY = cropY + (retryResult.y * cropSize);

              console.log(`[Tool: locateUIElement] Zoomed Vision (Scaled):`, { x: scaledRetryX, y: scaledRetryY });

              if (retryResult.confidence > initialResult.confidence) {
                finalResult = {
                  x: scaledRetryX,
                  y: scaledRetryY,
                  confidence: retryResult.confidence,
                  label: retryResult.label || targetDesc
                };
              }
            }
            fs.unlinkSync(cropPath);
          }
        }

        if (fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath);

        if (finalResult && finalResult.x >= 0 && finalResult.y >= 0) {
          resolve({
            x: finalResult.x,
            y: finalResult.y,
            confidence: finalResult.confidence || 0.5,
            label: finalResult.label || targetDesc
          });
        } else {
          resolve({ error: "Not found", confidence: 0, label: targetDesc });
        }

      } catch (err) {
        if (fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath);
        resolve({ error: err.message });
      }
    });
  });
}
