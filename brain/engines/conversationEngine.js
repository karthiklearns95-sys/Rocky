/**
 * ConversationEngine: Handles general chat and queries.
 */
export default class ConversationEngine {
  constructor(responseFormatter) {
    this.responseFormatter = responseFormatter;
  }

  async handle(intentResult) {
    // Inject follow-up directive for the LLM
    const conversationalIntent = {
      ...intentResult,
      intent: `${intentResult.intent} (INSTRUCTION: If appropriate, end your response with a short, optional follow-up question like "Grace, want me to go deeper?" or "Should I continue?". Keep it very brief and natural to your personality.)`
    };

    // Format a response based on the intent
    const response = await this.responseFormatter.format(conversationalIntent, []);
    
    return {
      type: 'response',
      data: response
    };
  }
}
