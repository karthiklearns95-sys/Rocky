import BaseProvider from './baseProvider.js';

export default class LocalProvider extends BaseProvider {
  constructor(modelPath) {
    super();
    this.modelPath = modelPath;
    console.log(`[LocalProvider] Initialized with model at: ${modelPath}`);
  }

  async generate(prompt, options = {}) {
    // Mock local inference call
    console.log(`[LocalProvider] Running local inference for: "${prompt}"`);
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(`This is a local inference response for: ${prompt}`);
      }, 2000); // Local is slightly slower in this mock
    });
  }

  async generateStructured(prompt, schema, options = {}) {
    console.log(`[LocalProvider] Running local structured inference for: "${prompt}"`);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (prompt.includes('intent')) {
          resolve({ intent: 'greeting', confidence: 0.8 });
        } else if (prompt.includes('plan')) {
          resolve({ plan: ['Say hello locally'], requiredTools: [] });
        } else {
          resolve({ result: 'unknown' });
        }
      }, 2000);
    });
  }
}
