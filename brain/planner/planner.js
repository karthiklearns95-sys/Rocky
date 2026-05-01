export default class Planner {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  async createPlan(intentResult, context) {
    console.log(`[Planner] Creating plan for intent: ${intentResult.intent}`);
    
    // Abstracted schema request
    const schema = {
      type: "object",
      properties: {
        plan: { type: "array", items: { type: "string" } },
        requiredTools: { type: "array", items: { type: "string" } }
      }
    };
    
    const result = await this.aiProvider.generateStructured(
      `Create execution plan for intent: ${intentResult.intent} with context: ${JSON.stringify(context)}`,
      schema
    );
    return result;
  }
}
