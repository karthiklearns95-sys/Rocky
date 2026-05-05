import screenshot from 'screenshot-desktop';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import VisionHandler from '../../brain/vision/visionHandler.js';
import getActiveWindow from '../../executor/system/getActiveWindow.js';
import { normalizeUIMap } from '../../memory/uiMapStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Tool: analyze_ui
 * Captures a screenshot of the active window and uses vision to map the UI.
 */
export default async function analyze_ui(args = {}, aiProvider) {
  const tempDir = path.join(__dirname, '..', '..', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  
  const screenshotPath = path.join(tempDir, `ui_analysis_${Date.now()}.jpg`);
  
  try {
    const currentWindow = args.currentWindow || await getActiveWindow();
    console.log('[Tool: analyze_ui] Capturing screen for analysis...');
    await screenshot({ filename: screenshotPath });
    
    const base64Image = fs.readFileSync(screenshotPath, { encoding: 'base64' });
    
    const visionHandler = new VisionHandler(aiProvider);
    const prompt = `
      Analyze this desktop application screenshot for Rocky's UI map cache.
      Current active window:
      app: ${currentWindow.appName}
      title: ${currentWindow.windowTitle}
      bounds: ${JSON.stringify(currentWindow.bounds || {})}

      Identify stable, clickable or focusable UI elements that are useful for automation.
      Return ONLY valid JSON in this exact shape:
      {
        "elements": [
          {
            "label": "search_bar",
            "x": number,
            "y": number,
            "width": number,
            "height": number,
            "confidence": number
          }
        ],
        "confidence": number
      }

      Rules:
      - x and y are absolute screen coordinates at the center of the element.
      - width and height are estimated pixel dimensions.
      - confidence is 0.0 to 1.0.
      - Prefer stable semantic labels like search_bar, play_pause_button, sidebar, close_button.
      - Do not include elements you cannot locate with confidence.
    `;
    
    let rawUIMap = await visionHandler.analyze(prompt, base64Image);
    if (typeof rawUIMap === 'string') {
      try {
        rawUIMap = JSON.parse(rawUIMap.replace(/```json\n?|```/g, '').trim());
      } catch {
        rawUIMap = { elements: [], confidence: 0 };
      }
    }

    const uiMap = normalizeUIMap({
      ...rawUIMap,
      app: currentWindow.appName,
      windowTitle: currentWindow.windowTitle,
      bounds: currentWindow.bounds
    }, currentWindow);
    
    // Cleanup
    try { fs.unlinkSync(screenshotPath); } catch { /* ignore cleanup failure */ }
    
    return {
      success: true,
      uiMap: uiMap,
      confidence: uiMap.confidence,
      message: "UI analysis complete. Coordinates identified."
    };
  } catch (error) {
    console.error('[Tool: analyze_ui] Error:', error);
    return { success: false, error: error.message };
  }
}
