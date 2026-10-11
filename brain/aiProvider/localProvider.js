import BaseProvider from '#brain/aiProvider/baseProvider.js';
import { formatResponse } from '#brain/personality/rockyPersonality.js';
import { validateAgainstSchema } from '#brain/aiProvider/schemaValidator.js';
import config from '../../config/app.config.js';

export default class LocalProvider extends BaseProvider {
  constructor(modelName = config.models.brain) {
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
          keep_alive: config.ollamaKeepAlive,
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

    const structuredPrompt =
      `${prompt}\n\nRespond ONLY with a JSON object that follows the required schema. ` +
      `Do NOT echo the schema, and do not add markdown fences or prose.`;

    // The schema is passed to Ollama as `format`, so the model's output is
    // grammar-constrained to it instead of being merely "some JSON".
    const callOllama = async (p) => {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          prompt: p,
          stream: false,
          format: schema && typeof schema === 'object' ? schema : 'json',
          keep_alive: config.ollamaKeepAlive,
          options
        })
      });
      if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);
      const data = await response.json();
      return data.response || '';
    };

    const safeFallback = () => {
      if (schema.properties?.goal)   return this._enforceSchema({ goal: 'chat', entities: {}, domain: 'conversation', confidence: 0.0, actionable: false }, schema);
      if (schema.properties?.intent) return this._enforceSchema({ intent: 'chat', confidence: 0.0 }, schema);
      return this._enforceSchema({}, schema);
    };

    // Returns { parsed, problems }; parsed is null when the text is not JSON.
    const check = (raw) => {
      const parsed = this._repairJSON(raw);
      if (!parsed) return { parsed: null, problems: ['output was not valid JSON'] };
      return { parsed, problems: validateAgainstSchema(parsed, schema) };
    };

    try {
      let raw = await callOllama(structuredPrompt);
      let { parsed, problems } = check(raw);

      if (problems.length > 0) {
        console.warn(`[LocalProvider] Structured output invalid (${problems[0]}). Retrying with feedback...`);
        const retryPrompt =
          `${structuredPrompt}\n\nYour previous answer was rejected:\n${raw.substring(0, 500)}\n` +
          `Problems:\n- ${problems.slice(0, 5).join('\n- ')}\nReturn a corrected JSON object.`;
        raw = await callOllama(retryPrompt);
        ({ parsed, problems } = check(raw));
      }

      if (!parsed) {
        console.error('[LocalProvider] Structured response unparseable after retry. Raw:', raw.substring(0, 200));
        return safeFallback();
      }
      if (problems.length > 0) {
        console.warn(`[LocalProvider] Structured output still off-schema after retry: ${problems.join('; ')}`);
      }

      // Last resort: fill any missing fields with typed defaults.
      return this._enforceSchema(parsed, schema);

    } catch (error) {
      console.error('[LocalProvider] Structured Gen Error:', error.message);
      return safeFallback();
    }
  }

  /**
   * Vision Support - Calls a vision model (e.g., llava)
   */
  async generateVision(prompt, imageBase64, modelName = config.models.vision) {
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
          keep_alive: config.ollamaKeepAlive,
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
      return { error: `Rocky's eyes are blurry. Make sure '${modelName}' is installed in Ollama (ollama pull ${modelName}).` };
    }
  }

  /**
   * Generates a float array embedding for RAG memory (non-blocking).
   */
  async embed(text, fallbackModel = config.models.embedding) {
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
           console.warn(`[LocalProvider] ⚠️ '${fallbackModel}' not found or failed. Falling back to '${this.modelName}' for embeddings. This will degrade memory quality!`);
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
