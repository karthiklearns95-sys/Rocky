import BaseProvider from '#brain/aiProvider/baseProvider.js';
import { formatResponse } from '#brain/personality/rockyPersonality.js';

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
          stream: options.stream || false,
          options: options
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      if (options.stream) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          
          const lines = chunk.split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.response) {
                fullText += parsed.response;
                // Emit event for streaming TTS
                import('#services/eventBus.js').then(({ default: eventBus }) => {
                  eventBus.emit('TOKEN_GENERATED', parsed.response);
                });
              }
            } catch {
              // ignore parse error on partial chunks
            }
          }
        }
        return options.skipFormat ? fullText.trim() : formatResponse(fullText);
      } else {
        const data = await response.json();
        const text = data.response || "";
        
        if (!text.trim()) {
          console.warn('[LocalProvider] Ollama returned empty, using personality fallback');
          return options.skipFormat ? '' : formatResponse("Grace... Rocky is thinking deeply. Amaze.");
        }
        
        return options.skipFormat ? text.trim() : formatResponse(text);
      }
    } catch (error) {
      console.error('[LocalProvider] Error calling Ollama:', error);
      return options.skipFormat ? '' : formatResponse("Grace… Rocky's local brain is a bit slow today. Let me try to remember. Amaze.");
    }
  }

  async generateStructured(prompt, schema, options = {}) {
    console.log(`[LocalProvider] Requesting Ollama structured data for: "${prompt.substring(0, 60)}..."`);
    
    const structuredPrompt = `
      ${prompt}
      
      Respond ONLY with a valid JSON object in this exact structure:
      ${JSON.stringify(schema, null, 2)}
      
      Do NOT include the schema definition (no "type", "properties", or "required" at the root). 
      ONLY return the final data object. No conversation.
    `;

    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          prompt: structuredPrompt,
          stream: false,
          format: 'json', 
          options: options
        })
      });

      if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);

      const data = await response.json();
      if (!data.response || !data.response.trim()) {
        throw new Error("Empty structured response");
      }

      try {
        const parsed = JSON.parse(data.response);
        // Ensure required fields exist based on schema hint
        if (schema.properties?.intent && !parsed.intent) parsed.intent = 'chat';
        if (schema.properties?.plan && !parsed.plan) parsed.plan = ["Rocky is thinking..."];
        
        return parsed;
      } catch {
        console.error('[LocalProvider] JSON Parse Error. Raw:', data.response);
        // Intelligent fallback based on prompt context
        if (prompt.includes('intent')) return { intent: 'chat', confidence: 0.8 };
        if (prompt.includes('tool')) return { plan: ["Rocky will talk to you"], toolCalls: [] };
        return { error: "Invalid JSON" };
      }
    } catch (error) {
      console.error('[LocalProvider] Structured Gen Error:', error.message);
      if (prompt.includes('intent')) return { intent: 'chat', confidence: 0.1 };
      return { plan: ["Rocky's brain is offline"], toolCalls: [] };
    }
  }

  /**
   * Vision Support - Calls a vision model (e.g., llava)
   */
  async generateVision(prompt, imageBase64, modelName = 'llava') {
    console.log(`[LocalProvider] Requesting Ollama Vision (${modelName}) for: "${prompt.substring(0, 60)}..."`);
    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          prompt: prompt,
          images: [imageBase64],
          stream: false,
          format: 'json'
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama Vision error: ${response.statusText}`);
      }

      const data = await response.json();
      try {
        return JSON.parse(data.response);
      } catch {
        // If not JSON, return raw text
        return data.response;
      }
    } catch (error) {
      console.error('[LocalProvider] Vision Error:', error);
      return { error: "Rocky's eyes are blurry. Make sure 'llava' is installed in Ollama." };
    }
  }

  /**
   * Generates a float array embedding for RAG memory (non-blocking).
   */
  async embed(text, fallbackModel = 'nomic-embed-text') {
    try {
      // Use AbortController for strict timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // keep memory non-blocking but avoid false aborts
      
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: fallbackModel,
          prompt: text
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);

      if (!response.ok) {
        // Fallback to the main model if nomic-embed-text isn't installed
        if (fallbackModel !== this.modelName) {
           console.warn(`[LocalProvider] ⚠️ 'nomic-embed-text' not found or failed. Falling back to '${this.modelName}' for embeddings. This will degrade memory quality!`);
           return await this.embed(text, this.modelName);
        }
        throw new Error(`Embedding API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.embedding;
    } catch (err) {
      console.error(`[LocalProvider] Embedding Error: ${err.message}`);
      return null; // Safe fallback
    }
  }
}
