import getUIElements from '#tools/system/getUIElements.js';
import ocrSearch from '#tools/system/ocrSearch.js';
import { rankElements } from '#tools/system/elementMatcher.js';
import { pickDisplay, captureForVision, mapModelPoint } from '../../vision/screenImage.js';
import config from '../../config/app.config.js';

/**
 * Hybrid Visual Grounding — Priority order:
 * 1. UIA Semantic Tree (instant, reliable, accurate)
 * 2. OCR via Windows WinRT (fast ~200ms, finds any visible text)
 * 3. LLaVA Vision Fallback (slow ~5-8s, last resort for icons/images)
 */
export default async function locateUIElement(args, aiProvider) {
  const { description, query, label, target } = args;
  const targetDesc = description || query || label || target;
  if (!targetDesc) return { success: false, error: 'No description provided.' };

  // Reject nonsense goal-name strings passed by mistake
  if (/^[a-z_]+$/.test(targetDesc) && targetDesc.includes('_')) {
    console.warn(`[locateUIElement] Received goal-name "${targetDesc}" instead of UI description. Failing fast.`);
    return { success: false, error: `"${targetDesc}" is not a valid UI element description.` };
  }

  console.log(`[locateUIElement] Looking for: "${targetDesc}"`);

  // ─── LAYER 1: UIA Semantic Tree ───────────────────────────────────────────
  // Search INSIDE the foreground app (its buttons, menus, fields). The old call used the
  // desktop root, which only lists top-level windows, so this tier could never find a button.
  const uiaResult = await getUIElements({ foregroundOnly: true, maxElements: 400 });
  if (uiaResult.success && uiaResult.elements?.length > 0) {
    const [best] = rankElements(uiaResult.elements, targetDesc);
    if (best) {
      console.log(`[locateUIElement] ✅ UIA match: "${best.element.Name}" at (${best.x}, ${best.y}) score=${best.score}`);
      return { success: true, x: best.x, y: best.y, confidence: best.score, label: best.element.Name, source: 'UIA' };
    }
  }

  // ─── LAYER 2: OCR ─────────────────────────────────────────────────────────
  console.log(`[locateUIElement] UIA miss. Trying OCR for "${targetDesc}"...`);
  const ocrResult = await ocrSearch({ query: targetDesc });
  if (ocrResult && Number.isFinite(ocrResult.x)) {
    console.log(`[locateUIElement] ✅ OCR match: "${ocrResult.label}" at (${ocrResult.x}, ${ocrResult.y})`);
    return { success: true, x: ocrResult.x, y: ocrResult.y, confidence: ocrResult.confidence, label: ocrResult.label, source: 'OCR' };
  }

  // ─── LAYER 3: LLaVA Vision Model (Last Resort) ────────────────────────────
  if (!aiProvider) {
    return { success: false, error: `"${targetDesc}" not found via UIA or OCR, and no AI provider for vision fallback.` };
  }

  console.log(`[locateUIElement] OCR miss. Falling back to LLaVA vision for "${targetDesc}"...`);

  // Look at the monitor Grace is working on; the answer is mapped back to desktop coordinates.
  let shot;
  try {
    const { display } = await pickDisplay();
    if (!display) return { success: false, error: 'Screenshot capture failed for LLaVA fallback.' };
    shot = await captureForVision(display);
  } catch (err) {
    console.warn('[locateUIElement] screen capture failed:', err.message);
    return { success: false, error: 'Screenshot capture failed for LLaVA fallback.' };
  }

  try {
    const visionPrompt = `You are a precise UI locator. Find the EXACT position in this image of the UI element described as: "${targetDesc}".
Return ONLY valid JSON with no extra text: {"x": number, "y": number, "confidence": number, "label": string}
Use ABSOLUTE pixel coordinates in this image (not normalized). If not found, return {"x": -1, "y": -1, "confidence": 0, "label": "not_found"}.`;

    const result = await aiProvider.generateVision(visionPrompt, shot.base64, config.models.vision);
    const point = result?.confidence > 0.3 ? mapModelPoint(result, shot.display, shot) : null;

    if (point) {
      console.log(`[locateUIElement] ✅ LLaVA match: "${result.label}" at (${point.x}, ${point.y}) conf=${result.confidence}`);
      return { success: true, x: point.x, y: point.y, confidence: result.confidence, label: result.label, source: 'LLaVA' };
    }

    return { success: false, error: `"${targetDesc}" not found on screen (LLaVA conf=${result?.confidence ?? 0}).` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
