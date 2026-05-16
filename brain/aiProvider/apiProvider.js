import { GoogleGenAI } from '@google/genai';
import BaseProvider from '#brain/aiProvider/baseProvider.js';

/** Retry a fn up to maxRetries times on 503/429, with exponential backoff */
async function retryWithBackoff(fn, maxRetries = 3) {
  let delay = 1000;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Handle both structured error objects and raw status codes
      console.error('[ApiProvider] Gemini Request Failed:', err.message || err);
      const code = err?.status || err?.error?.code || (err?.message?.includes('503') ? 503 : null);
      const isRetryable = [500, 502, 503, 504, 429].includes(Number(code));
      
      if (isRetryable && attempt < maxRetries) {
        console.warn(`[ApiProvider] Gemini ${code} — retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
}

export default class ApiProvider extends BaseProvider {
  constructor(apiKey) {
    super();
    if (!apiKey) {
      console.warn('[ApiProvider] WARNING: No API key provided for Gemini. Calls will fail.');
    }
    this.ai = new GoogleGenAI({ apiKey: apiKey });
    this.modelName = 'gemini-1.5-flash'; // Switched to 1.5-flash for stability
  }

  async generate(prompt, options = {}) {
    console.log(`[ApiProvider] Generating text via Gemini for: "${prompt.substring(0, 50)}..."`);
    return retryWithBackoff(async () => {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: options  // @google/genai uses 'config'
      });
      return response.text;
    });
  }

  async generateStructured(prompt, schema, options = {}) {
    console.log(`[ApiProvider] Generating structured data via Gemini for: "${prompt.substring(0, 50)}..."`);
    return retryWithBackoff(async () => {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {           // @google/genai uses 'config'
          ...options,
          responseMimeType: 'application/json',
          responseSchema: schema,
        }
      });
      const rawText = response.text;
      try {
        // Sanitize: sometimes models wrap JSON in markdown blocks even with responseMimeType
        const sanitized = rawText.replace(/```json\n?|```/g, '').trim();
        return JSON.parse(sanitized);
      } catch (parseError) {
        console.error('[ApiProvider] Failed to parse structured output:', rawText);
        throw new Error('LLM did not return valid JSON');
      }
    });
  }
}
