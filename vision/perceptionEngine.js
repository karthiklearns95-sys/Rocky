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
    timeoutMs = 60000;   // the first use downloads its English data (~10 MB)

    
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
        // tesseract.js 6+ only returns the layout when asked ({ blocks: true }), and then nested:
        // blocks > paragraphs > lines > words. The old code read data.lines, which no longer exists.
        // errorHandler: without it a failed language download (offline) is thrown from inside the OCR
        // worker, outside any try/catch, and takes the whole app down. With it, a failed start can
        // wait forever instead, so the whole attempt is also given a time limit.
        let worker = null;
        const attempt = (async () => {
          worker = await Tesseract.createWorker('eng', 1, { errorHandler: () => {} });
          return (await worker.recognize(imgBuffer, {}, { blocks: true })).data;
        })();
        attempt.catch(() => {});
        let timer;
        const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Tesseract OCR gave up after ${this.timeoutMs / 1000} s (its English data downloads on first use)`)), this.timeoutMs); });
        let data;
        try { data = await Promise.race([attempt, limit]); }
        finally { clearTimeout(timer); worker?.terminate().catch(() => {}); }
        const lines = (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => p.lines || []));
        const words = lines.flatMap((l) => l.words || []);
        const targetLower = targetText.toLowerCase();
        const box = (b) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });

        const lineMatch = lines.find(l => String(l.text || '').toLowerCase().includes(targetLower));
        if (lineMatch) return box(lineMatch.bbox);

        const wordMatch = words.find(w => {
            const t = String(w.text || '').toLowerCase().trim();
            return t.length > 1 && (t.includes(targetLower) || targetLower.includes(t));
        });
        return wordMatch ? box(wordMatch.bbox) : null;
    }
}

export const perceptionEngine = new PerceptionEngine();
