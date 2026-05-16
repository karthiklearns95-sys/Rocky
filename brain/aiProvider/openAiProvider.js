import OpenAI from 'openai';
import BaseProvider from '#brain/aiProvider/baseProvider.js';

export default class OpenAiProvider extends BaseProvider {
  constructor(apiKey) {
    super();
    this.client = new OpenAI({ apiKey: apiKey });
    this.modelName = 'gpt-4o-mini'; // Fast and smart default
  }

  async generate(prompt, options = {}) {
    console.log(`[OpenAiProvider] Generating text via OpenAI for: "${prompt.substring(0, 50)}..."`);
    try {
      const isStreaming = options.stream || false;
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        stream: isStreaming,
        ...options
      });
      
      if (isStreaming) {
        let fullText = "";
        for await (const chunk of response) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            fullText += content;
            import('#services/eventBus.js').then(({ default: eventBus }) => {
              eventBus.emit('TOKEN_GENERATED', content);
            });
          }
        }
        return fullText;
      }

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

  /**
   * Generates a float array embedding for RAG memory (non-blocking).
   */
  async embed(text) {
    try {
      const response = await this.client.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
        encoding_format: "float",
      });
      return response.data[0].embedding;
    } catch (err) {
      console.error(`[OpenAiProvider] Embedding Error: ${err.message}`);
      return null;
    }
  }
}
