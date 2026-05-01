export default class IntentParser {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  async parse(input) {
    console.log(`[IntentParser] Parsing input: "${input}"`);
    
    // Abstracted schema request
    const schema = {
      type: "object",
      properties: {
        intent: { type: "string" },
        confidence: { type: "number" }
      }
    };
    
    const result = await this.aiProvider.generateStructured(`Extract intent from: ${input}`, schema);
    return result;
  }
}
