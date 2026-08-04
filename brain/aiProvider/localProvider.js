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

  /**
   * Extract and repair a JSON object from raw LLM text.
   * Local models frequently wrap JSON in markdown fences or use single quotes.
   * Tries three strategies in order:
   *   1. Direct JSON.parse (fast path)
   *   2. Strip markdown fences then parse
   *   3. Replace Python-style single-quote keys/values then parse
   * Returns null if all strategies fail.
   */
  _repairJSON(raw) {
    if (!raw || !raw.trim()) return null;
    const text = raw.trim();

    // Strategy 1: Direct parse
    try { return JSON.parse(text); } catch {}

    // Strategy 2: Strip markdown code fences (```json ... ``` or ``` ... ```)
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      try { return JSON.parse(fenceMatch[1].trim()); } catch {}
    }

    // Strategy 3: Grab first JSON object/array literal in the string
    const jsonMatch = text.match(/({[\s\S]*}|\[[\s\S]*\])/m);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1]); } catch {}
    }

    // Strategy 4: Single-quote → double-quote repair (Python-style output)
    try {
      const repaired = text
        .replace(/'/g, '"')
        .replace(/,\s*}/g, '}')    // trailing commas
        .replace(/,\s*]/g, ']');
      return JSON.parse(repaired);
    } catch {}

    return null;
  }

  /**
   * Validate a parsed object against a JSON-schema-lite definition.
   * Fills in missing required fields with safe typed defaults so callers
   * always receive a structurally sound object.
   */
  _enforceSchema(obj, schema) {
    if (!obj || typeof obj !== 'object') return obj;
    const props = schema?.properties || {};
    for (const [key, def] of Object.entries(props)) {
      if (obj[key] === undefined || obj[key] === null) {
        // Fill with a typed default
        if (def.type === 'string')  obj[key] = def.default ?? '';
        if (def.type === 'number')  obj[key] = def.default ?? 0;
        if (def.type === 'boolean') obj[key] = def.default ?? false;
        if (def.type === 'array')   obj[key] = def.default ?? [];
        if (def.type === 'object')  obj[key] = def.default ?? {};
        if (def.enum)               obj[key] = def.enum[0];  // first enum value as default
      } else if (def.enum && !def.enum.includes(obj[key])) {
        // Invalid enum value — coerce to first allowed value
        obj[key] = def.enum[0];
      }
    }
    return obj;
  }

  async generateStructured(prompt, schema, options = {}) {
    console.log(`[LocalProvider] Requesting Ollama structured data for: "${prompt.substring(0, 60)}..."`);
    
    const requiredFields = schema?.required ? `\nRequired fields: ${schema.required.join(', ')}` : '';
    const structuredPrompt =
      `${prompt}\n\nRespond ONLY with a valid JSON object matching this schema:` +
      `\n${JSON.stringify(schema, null, 2)}${requiredFields}` +
      `\n\nDo NOT include the schema definition, markdown fences, or prose. Return ONLY the JSON object.`;

    const callOllama = async (p) => {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          prompt: p,
          stream: false,
          format: 'json',
          options
        })
      });
      if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);
      const data = await response.json();
      return data.response || '';
    };

    try {
      // First attempt
      let raw = await callOllama(structuredPrompt);
      let parsed = this._repairJSON(raw);

      // Retry once with an even stricter prompt if parse failed
      if (!parsed) {
        console.warn('[LocalProvider] First structured response unparseable. Retrying with strict prompt...');
        const retryPrompt =
          `JSON ONLY. No prose. No markdown. Return exactly this structure with real values:\n` +
          `${JSON.stringify(schema.properties ? Object.fromEntries(
            Object.entries(schema.properties).map(([k, v]) => [k, v.type || ''])
          ) : schema)}\n\nContext: ${prompt.substring(0, 300)}`;
        raw = await callOllama(retryPrompt);
        parsed = this._repairJSON(raw);
      }

      if (!parsed) {
        console.error('[LocalProvider] Structured response unparseable after retry. Raw:', raw.substring(0, 200));
        // Context-aware safe fallback
        if (schema.properties?.goal)   return this._enforceSchema({ goal: 'chat', entities: {}, domain: 'conversation', confidence: 0.0, actionable: false }, schema);
        if (schema.properties?.intent) return this._enforceSchema({ intent: 'chat', confidence: 0.0 }, schema);
        return this._enforceSchema({}, schema);
      }

      // Enforce schema contract on successfully parsed object
      return this._enforceSchema(parsed, schema);

    } catch (error) {
      console.error('[LocalProvider] Structured Gen Error:', error.message);
      if (schema.properties?.goal)   return this._enforceSchema({ goal: 'chat', entities: {}, domain: 'conversation', confidence: 0.0, actionable: false }, schema);
      if (schema.properties?.intent) return this._enforceSchema({ intent: 'chat', confidence: 0.0 }, schema);
      return this._enforceSchema({}, schema);
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
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout to allow local model to hot-load
      
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
