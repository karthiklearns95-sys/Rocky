import VisionHandler from '#vision/visionHandler.js';
import { pickDisplay, captureForVision, mapModelPoint } from '../../vision/screenImage.js';
import getActiveWindow from '../../automation/system/getActiveWindow.js';
import { normalizeUIMap } from '#memory/uiMapStore.js';

/**
 * Tool: analyze_ui
 * Captures a screenshot of the active window and uses vision to map the UI.
 */
export default async function analyze_ui(args = {}, aiProvider) {
  try {
    const currentWindow = args.currentWindow || await getActiveWindow();
    console.log('[Tool: analyze_ui] Capturing screen for analysis...');
    // The monitor holding the app is the one captured; positions are mapped back afterwards.
    const { display } = await pickDisplay({ activeWindow: currentWindow });
    if (!display) throw new Error('No screen to capture.');
    const shot = await captureForVision(display);
    const base64Image = shot.base64;
    
    const visionHandler = new VisionHandler(aiProvider);
    const prompt = `
      Analyze this desktop application screenshot for Rocky's UI map cache.
      Current active window:
      app: ${currentWindow.appName}
      title: ${currentWindow.windowTitle}
      bounds on the desktop: ${JSON.stringify(currentWindow.bounds || {})}
      The image shows one monitor only; its top-left corner is (0, 0).

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
      - x and y are pixel coordinates in this image, at the center of the element.
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

    // Back to desktop pixels (the monitor may sit at an offset, even a negative one).
    if (Array.isArray(rawUIMap?.elements)) {
      rawUIMap.elements = rawUIMap.elements
        .map((el) => {
          const p = mapModelPoint(el, shot.display, shot, { space: 'pixels' });
          return p ? { ...el, x: p.x, y: p.y } : null;
        })
        .filter(Boolean);
    }

    const uiMap = normalizeUIMap({
      ...rawUIMap,
      app: currentWindow.appName,
      windowTitle: currentWindow.windowTitle,
      bounds: currentWindow.bounds
    }, currentWindow);
    
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
