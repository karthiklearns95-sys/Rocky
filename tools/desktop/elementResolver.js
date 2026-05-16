import { desktopSession } from './desktopSessionStore.js';
import ocrSearch from '../system/ocrSearch.js';
import { mouseClick } from '../system/guiControl.js';

/**
 * elementResolver.js
 * 
 * Implements the required Execution Hierarchy:
 * 1. UIA (handled via uiaManager in desktopController)
 * 2. OCR (fallback when UIA fails to find the element)
 */
export async function fallbackResolveAndClick(query) {
  console.log(`[elementResolver] UIA failed for "${query}". Falling back to OCR...`);
  
  // OCR fallback
  const ocrResult = await ocrSearch({ query });
  if (ocrResult) {
    console.log(`[elementResolver] OCR matched "${query}" at (${ocrResult.x}, ${ocrResult.y})`);
    await mouseClick({ x: ocrResult.x, y: ocrResult.y });
    return { success: true, method: 'ocr' };
  }

  // Vision fallback would go here via LLaVA
  return { success: false, error: 'All resolution layers failed.' };
}
