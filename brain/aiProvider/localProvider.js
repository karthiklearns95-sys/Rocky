import BaseProvider from './baseProvider.js';
import { formatResponse } from '../personality/rockyPersonality.js';

export default class LocalProvider extends BaseProvider {
  constructor(modelName = 'llama3') {
    super();
    this.modelName = modelName;
    this.baseUrl = 'http://localhost:11434/api';
    console.log(`[LocalProvider] Initialized using Ollama with model: ${modelName}`);
  }

  async generate(prompt, options = {}) {
    console.log(`[LocalProvider] Requesting Ollama generation for: "${prompt.substring(0, 60)}..."`);
    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          prompt: prompt,
          stream: false,
          options: options
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json();
      return formatResponse(data.response);
    } catch (error) {
      console.error('[LocalProvider] Error calling Ollama:', error);
      return formatResponse("Grace… Rocky is having trouble connecting to local brain. Is Ollama running?");
    }
  }

  async generateStructured(prompt, schema, options = {}) {
    console.log(`[LocalProvider] Requesting Ollama structured data for: "${prompt.substring(0, 60)}..."`);
    
    // For structured data with Ollama, we'll use a prompt-based approach since 
    // basic Ollama doesn't support JSON schemas as robustly as Gemini yet.
    const structuredPrompt = `
      ${prompt}
      
      Respond ONLY with a valid JSON object matching this schema:
      ${JSON.stringify(schema, null, 2)}
      
      Strictly return ONLY the JSON. No conversational text.
    `;

    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          prompt: structuredPrompt,
          stream: false,
          format: 'json', // Ollama supports JSON mode
          options: options
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json();
      try {
        return JSON.parse(data.response);
      } catch (parseError) {
        console.error('[LocalProvider] Failed to parse Ollama JSON:', data.response);
        // Fallback for intent parsing if JSON fails
        if (prompt.includes('intent')) return { intent: 'general_query', confidence: 0.5 };
        throw parseError;
      }
    } catch (error) {
      console.error('[LocalProvider] Error in Ollama structured generation:', error);
      throw error;
    }
  }
}
