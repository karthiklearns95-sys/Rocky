import OpenAI from 'openai';
import BaseProvider from './baseProvider.js';

export default class OpenAiProvider extends BaseProvider {
  constructor(apiKey) {
    super();
    this.client = new OpenAI({ apiKey: apiKey });
    this.modelName = 'gpt-4o-mini'; // Fast and smart default
  }

  async generate(prompt, options = {}) {
    console.log(`[OpenAiProvider] Generating text via OpenAI for: "${prompt.substring(0, 50)}..."`);
    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        ...options
      });
      return response.choices[0].message.content;
    } catch (error) {
      console.error('[OpenAiProvider] Error generating text:', error);
      throw error;
    }
  }

  async generateStructured(prompt, schema, options = {}) {
    console.log(`[OpenAiProvider] Generating structured data via OpenAI for: "${prompt.substring(0, 50)}..."`);
    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" },
        ...options
      });
      
      const rawText = response.choices[0].message.content;
      try {
        return JSON.parse(rawText);
      } catch (parseError) {
        console.error('[OpenAiProvider] Failed to parse structured output:', rawText);
        throw new Error('LLM did not return valid JSON');
      }
    } catch (error) {
      console.error('[OpenAiProvider] Error generating structured data:', error);
      throw error;
    }
  }
}
