export default class ResponseFormatter {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  async format(intentResult, executionResults) {
    console.log(`[ResponseFormatter] Formatting response for intent: ${intentResult.intent}`);
    
    const prompt = `
      You are Rocky, a helpful AI desktop companion. Address the user as Grace.
      Based on the following intent and execution results, provide a natural conversational response.
      Intent: ${intentResult.intent}
      Results: ${JSON.stringify(executionResults)}
    `;
    
    // Abstracted text generation
    const responseText = await this.aiProvider.generate(prompt);
    return responseText;
  }
}
