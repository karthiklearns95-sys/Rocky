import { perceptionEngine } from '../../vision/perceptionEngine.js';
import { mouseClick, typeText, pressKey } from '../system/guiControl.js';
import getUIElements from '../system/getUIElements.js';
import ocrSearch from '../system/ocrSearch.js';
import { rankElements } from '../system/elementMatcher.js';

/**
 * Where is the control described as `query`? Best source first:
 *   1. UI Automation in the foreground app: the control itself (exact, instant)
 *   2. Windows OCR: the text on screen (a label; the control is usually just below/next to it)
 *   3. Tesseract OCR: slower fallback for screens Windows OCR cannot read
 * @returns {Promise<{x:number,y:number,source:'UIA'|'OCR'|'Tesseract',isControl:boolean,box?:object}|null>}
 */
export async function locateOnScreen(query, { uia = getUIElements, ocr = ocrSearch, tesseract = (q) => perceptionEngine.locateTextOnScreen(q) } = {}) {
  try {
    const tree = await uia({ foregroundOnly: true, maxElements: 400 });
    if (tree?.success && tree.elements?.length) {
      const [best] = rankElements(tree.elements, query);
      if (best) return { x: best.x, y: best.y, source: 'UIA', isControl: true, label: best.element.Name };
    }
  } catch { /* next source */ }
  try {
    const hit = await ocr({ query });
    if (hit && Number.isFinite(hit.x)) return { x: hit.x, y: hit.y, source: 'OCR', isControl: false, label: hit.label };
  } catch { /* next source */ }
  try {
    const bbox = await tesseract(query);
    if (bbox) return { x: Math.floor(bbox.x + bbox.width / 2), y: Math.floor(bbox.y + bbox.height / 2), source: 'Tesseract', isControl: false, box: bbox };
  } catch { /* nothing found */ }
  return null;
}

/**
 * desktopController.js
 * 
 * Provides native desktop automation tools using Vision (OCR) + Nut.js.
 */

export async function desktopClick(args, { locate = locateOnScreen, click = mouseClick } = {}) {
  const { query, _signal } = args;
  if (!query) return { success: false, error: 'query is required' };

  console.log(`[Tool: desktopClick] Looking for "${query}"...`);
  const at = await locate(query);
  if (!at) return { success: false, error: `Could not find "${query}" on the screen.` };

  console.log(`[Tool: desktopClick] Found "${at.label || query}" via ${at.source} at (${at.x}, ${at.y}). Clicking.`);
  const result = await click({ x: at.x, y: at.y, _signal });
  if (result?.success) return { success: true, data: `Clicked on "${query}" (found via ${at.source}).` };
  return { success: false, error: result?.error || `Could not click "${query}".` };
}

/**
 * Type into the field described by `query`. If that field cannot be found, NOTHING is typed: typing
 * "into whatever has focus" once sent text and Enter into a terminal window.
 */
export async function desktopType(args, { locate = locateOnScreen, click = mouseClick, type = typeText, key = pressKey } = {}) {
  const { query, text, pressEnter, _signal } = args;
  if (!text) return { success: false, error: 'text is required' };

  if (query) {
    console.log(`[Tool: desktopType] Looking for the field "${query}"...`);
    const at = await locate(query);
    if (!at) {
      return { success: false, error: `Could not find a field called "${query}", so Rocky typed nothing.` };
    }
    // A UI Automation hit is the field itself; an OCR hit is its label, and the field is usually just below it.
    const target = at.isControl ? { x: at.x, y: at.y } : { x: at.x, y: at.y + 25 };
    console.log(`[Tool: desktopType] Found "${at.label || query}" via ${at.source}; clicking (${target.x}, ${target.y}) to focus.`);
    const clicked = await click({ ...target, _signal });
    if (clicked && clicked.success === false) return { success: false, error: `Could not click the field "${query}": ${clicked.error}` };
    await new Promise((r) => setTimeout(r, 120));
  }

  await type({ text, _signal });
  if (pressEnter) await key({ key: 'ENTER', _signal });
  return { success: true, data: `Typed into ${query ? `"${query}"` : 'the focused window'}.` };
}
