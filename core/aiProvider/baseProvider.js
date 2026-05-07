/**
 * Base AI Provider interface.
 * All specific providers (OpenAI, Anthropic, Local Llama, etc.) MUST implement these methods.
 */
export default class BaseProvider {
  /**
   * Generates a response based on a prompt.
   * @param {string} prompt 
   * @param {object} options (e.g. temperature, maxTokens)
   * @returns {Promise<string>}
   */
  async generate(prompt, options = {}) {
    throw new Error('Method "generate" must be implemented.');
  }

  /**
   * Generates structured data based on a prompt.
   * Useful for intent parsing, planning, etc.
   * @param {string} prompt 
   * @param {object} schema (JSON schema for output)
   * @returns {Promise<object>}
   */
  async generateStructured(prompt, schema, options = {}) {
    throw new Error('Method "generateStructured" must be implemented.');
  }
}
