import Tesseract from 'tesseract.js';
import screenshot from 'screenshot-desktop';
import { pickDisplay, captureForVision } from './screenImage.js';

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
            // Active monitor first, then the rest; boxes come back in desktop pixels.
            const { display, displays } = await pickDisplay();
            const order = display ? [display, ...displays.filter((d) => d !== display)] : [null];
            for (const d of order) {
                const imgBuffer = d ? (await captureForVision(d)).png : await screenshot({ format: 'png' });
                const found = await this._findInImage(imgBuffer, targetText);
                if (found) return d ? { ...found, x: found.x + d.x, y: found.y + d.y } : found;
            }
            console.log(`[PerceptionEngine] ❌ Vision fallback failed to locate "${targetText}".`);
        } catch (e) {
            console.warn(`[PerceptionEngine] Vision failure:`, e.message);
        }

        return null;
    }

    /** Run local OCR on one picture; the box is in that picture's pixels. */
    async _findInImage(imgBuffer, targetText) {
        const { data } = await Tesseract.recognize(imgBuffer, 'eng', {});
        const targetLower = targetText.toLowerCase();
        const box = (b) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });

        const lineMatch = data.lines.find(l => l.text.toLowerCase().includes(targetLower));
        if (lineMatch) return box(lineMatch.bbox);

        const wordMatch = data.words.find(w =>
            w.text.toLowerCase().includes(targetLower) || targetLower.includes(w.text.toLowerCase()));
        return wordMatch ? box(wordMatch.bbox) : null;
    }
}

export const perceptionEngine = new PerceptionEngine();
