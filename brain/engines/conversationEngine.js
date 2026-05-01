/**
 * ConversationEngine: Handles general chat and queries.
 */
export default class ConversationEngine {
  constructor(responseFormatter) {
    this.responseFormatter = responseFormatter;
  }

  async handle(intentResult) {
    // For conversation, we just format a response based on the intent
    const response = await this.responseFormatter.format(intentResult, []);
    return {
      type: 'response',
      data: response
    };
  }
}
