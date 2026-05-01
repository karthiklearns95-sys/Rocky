import BaseProvider from './baseProvider.js';

export default class ApiProvider extends BaseProvider {
  constructor(apiKey, endpoint) {
    super();
    this.apiKey = apiKey;
    this.endpoint = endpoint;
  }

  async generate(prompt, options = {}) {
    // Mock API call
    console.log(`[ApiProvider] Generating text for prompt: "${prompt}"`);
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(`This is a mock API response for: ${prompt}`);
      }, 1000);
    });
  }

  async generateStructured(prompt, schema, options = {}) {
    console.log(`[ApiProvider] Generating structured data for prompt: "${prompt}"`);
    return new Promise((resolve) => {
      setTimeout(() => {
        // Return a mock object depending on the request type
        if (prompt.includes('intent')) {
          resolve({ intent: 'greeting', confidence: 0.9 });
        } else if (prompt.includes('plan')) {
          resolve({ plan: ['Say hello'], requiredTools: [] });
        } else {
          resolve({ result: 'unknown' });
        }
      }, 1000);
    });
  }
}
