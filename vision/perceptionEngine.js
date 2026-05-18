import Tesseract from 'tesseract.js';
import screenshot from 'screenshot-desktop';

/**
 * Perception Engine
 * Fallback Computer Vision layer utilizing localized OCR to find UI elements
 * that are invisible or unmapped in the native UIA accessibility tree.
 * 
 * NOTE: Strictly a fallback. Does not use slow cloud VLM APIs.
 */
class PerceptionEngine {
    
    /**
     * Captures the screen and uses OCR to locate the bounding box of a target text.
     * @param {string} targetText The text label to find on screen
     * @returns {Object|null} Bounding box {x, y, width, height} or null if not found
     */
    async locateTextOnScreen(targetText) {
        if (!targetText) return null;
        console.log(`[PerceptionEngine] 👁️ UIA blind. Vision fallback engaging for: "${targetText}"`);
        
        try {
            // Take rapid in-memory screenshot buffer
            const imgBuffer = await screenshot({ format: 'png' });
            
            // Run localized OCR on the buffer natively (no network calls)
            const { data } = await Tesseract.recognize(imgBuffer, 'eng', {
                // logger: m => console.log(m) // Uncomment for debugging OCR progress
            });

            const targetLower = targetText.toLowerCase();

            // 1. Try to find an exact line match first
            const lineMatch = data.lines.find(l => l.text.toLowerCase().includes(targetLower));
            if (lineMatch) {
                const { x0, y0, x1, y1 } = lineMatch.bbox;
                return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
            }

            // 2. Try a word-level match as fallback
            const wordMatch = data.words.find(w => 
                w.text.toLowerCase().includes(targetLower) || 
                targetLower.includes(w.text.toLowerCase())
            );
            
            if (wordMatch) {
                const { x0, y0, x1, y1 } = wordMatch.bbox;
                return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
            }

            console.log(`[PerceptionEngine] ❌ Vision fallback failed to locate "${targetText}".`);
        } catch (e) {
            console.warn(`[PerceptionEngine] Vision failure:`, e.message);
        }
        
        return null;
    }
}

export const perceptionEngine = new PerceptionEngine();
