import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import getUIElements from '#tools/system/getUIElements.js';
import ocrSearch from '#tools/system/ocrSearch.js';
import { execWithTimeout } from '../../automation/system/execWithTimeout.js';

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

  const tempDir = process.env.TEMP || path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp');

  // ─── LAYER 1: UIA Semantic Tree ───────────────────────────────────────────
  const uiaResult = await getUIElements();
  if (uiaResult.success && uiaResult.elements?.length > 0) {
    const lower = targetDesc.toLowerCase();
    const found = uiaResult.elements.find(el =>
      el.Name && el.Name.toLowerCase() === lower
    ) || uiaResult.elements.find(el =>
      el.Name && el.Name.toLowerCase().includes(lower)
    ) || uiaResult.elements.find(el =>
      el.Name && lower.split(' ').some(word => word.length > 3 && el.Name.toLowerCase().includes(word))
    );

    if (found?.BoundingRectangle) {
      try {
        const parts = found.BoundingRectangle.split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
        if (parts.length >= 4) {
          const x = parts[0] + Math.round(parts[2] / 2);
          const y = parts[1] + Math.round(parts[3] / 2);
          console.log(`[locateUIElement] ✅ UIA match: "${found.Name}" at (${x}, ${y})`);
          return { success: true, x, y, confidence: 1.0, label: found.Name, source: 'UIA' };
        }
      } catch (e) {}
    }
  }

  // ─── LAYER 2: OCR ─────────────────────────────────────────────────────────
  console.log(`[locateUIElement] UIA miss. Trying OCR for "${targetDesc}"...`);
  const ocrResult = await ocrSearch({ query: targetDesc });
  if (ocrResult && ocrResult.x > 0) {
    console.log(`[locateUIElement] ✅ OCR match: "${ocrResult.label}" at (${ocrResult.x}, ${ocrResult.y})`);
    return { success: true, x: ocrResult.x, y: ocrResult.y, confidence: ocrResult.confidence, label: ocrResult.label, source: 'OCR' };
  }

  // ─── LAYER 3: LLaVA Vision Model (Last Resort) ────────────────────────────
  if (!aiProvider) {
    return { success: false, error: `"${targetDesc}" not found via UIA or OCR, and no AI provider for vision fallback.` };
  }

  console.log(`[locateUIElement] OCR miss. Falling back to LLaVA vision for "${targetDesc}"...`);
  const screenshotPath = path.join(tempDir, `vision_full_${Date.now()}.png`);

  // Use screenshot-desktop — no clipboard involvement, no SendKeys side-effects
  try {
    const screenshot = (await import('screenshot-desktop')).default;
    await screenshot({ filename: screenshotPath });
  } catch (err) {
    console.warn('[locateUIElement] screenshot-desktop failed, trying PowerShell CopyFromScreen:', err.message);
    const captureCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen; $b = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($s.Bounds.X, $s.Bounds.Y, 0, 0, $s.Bounds.Size); $b.Save('${screenshotPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose();"`;
    const { timedOut, error: capErr } = await execWithTimeout(captureCmd, { timeoutMs: 10000 });
    if (timedOut || capErr) {
      return { success: false, error: 'Screenshot capture failed for LLaVA fallback.' };
    }
  }

  if (!fs.existsSync(screenshotPath)) {
    return { success: false, error: 'Screenshot capture failed for LLaVA fallback.' };
  }

  try {
    const imageBase64 = fs.readFileSync(screenshotPath, { encoding: 'base64' });
    const visionPrompt = `You are a precise UI locator. Find the EXACT screen coordinates of the UI element described as: "${targetDesc}".
Return ONLY valid JSON with no extra text: {"x": number, "y": number, "confidence": number, "label": string}
Use ABSOLUTE pixel coordinates (not normalized). If not found, return {"x": -1, "y": -1, "confidence": 0, "label": "not_found"}.`;

    let result = await aiProvider.generateVision(visionPrompt, imageBase64, 'llava');

    // LLaVA may return normalized coords (0-1) — detect and scale using real screen dims
    if (result && result.x > 0 && result.x <= 1 && result.y > 0 && result.y <= 1) {
      const { stdout } = await execWithTimeout(
        `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height"`,
        { timeoutMs: 5000 }
      );
      const lines = (stdout || '').trim().split('\n').map(Number).filter(n => n > 0);
      const dims = lines.length >= 2 ? { width: lines[0], height: lines[1] } : { width: 1920, height: 1080 };
      result.x = Math.round(result.x * dims.width);
      result.y = Math.round(result.y * dims.height);
    }

    if (result?.x > 0 && result?.y > 0 && result?.confidence > 0.3) {
      console.log(`[locateUIElement] ✅ LLaVA match: "${result.label}" at (${result.x}, ${result.y}) conf=${result.confidence}`);
      return { success: true, x: result.x, y: result.y, confidence: result.confidence, label: result.label, source: 'LLaVA' };
    }

    return { success: false, error: `"${targetDesc}" not found on screen (LLaVA conf=${result?.confidence ?? 0}).` };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try { if (fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath); } catch (e) {}
  }
}
