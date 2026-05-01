import { GoogleGenAI } from '@google/genai';
import BaseProvider from './baseProvider.js';

export default class ApiProvider extends BaseProvider {
  constructor(apiKey) {
    super();
    if (!apiKey) {
      console.warn('[ApiProvider] WARNING: No API key provided for Gemini. Calls will fail.');
    }
    this.ai = new GoogleGenAI({ apiKey: apiKey });
    this.modelName = 'gemini-2.5-flash'; // Good default for speed and reasoning
  }

  async generate(prompt, options = {}) {
    console.log(`[ApiProvider] Generating text via Gemini for: "${prompt.substring(0, 50)}..."`);
    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: options
      });
      return response.text;
    } catch (error) {
      console.error('[ApiProvider] Error generating text:', error);
      throw error;
    }
  }

  async generateStructured(prompt, schema, options = {}) {
    console.log(`[ApiProvider] Generating structured data via Gemini for: "${prompt.substring(0, 50)}..."`);
    try {
      const config = {
        ...options,
        responseMimeType: 'application/json',
        responseSchema: schema,
      };
      
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: config
      });
      
      const rawText = response.text;
      try {
        return JSON.parse(rawText);
      } catch (parseError) {
        console.error('[ApiProvider] Failed to parse structured output:', rawText);
        throw new Error('LLM did not return valid JSON');
      }
    } catch (error) {
      console.error('[ApiProvider] Error generating structured data:', error);
      throw error;
    }
  }
}
