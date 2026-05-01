/**
 * IntentRouter: Determines which engine should handle a given intent.
 */
export default class IntentRouter {
  /**
   * Maps an intent to an engine name.
   * @param {Object} intentResult The result from IntentParser
   * @returns {string} The name of the engine to use
   */
  route(intentResult) {
    const { intent } = intentResult;
    const lowerInput = (intentResult.rawInput || '').toLowerCase();

    // Safety: If the input contains "open" or "launch", route to command engine regardless of intent
    if (lowerInput.includes('open ') || lowerInput.includes('launch ')) {
      return 'command';
    }
    const commandIntents = ['take_screenshot', 'open_app', 'system_control', 'file_manage'];
    if (commandIntents.includes(intent)) {
      return 'command';
    }

    // Task Engine: Complex or multi-step requests
    const taskIntents = ['web_search']; // For now, web search is treated as a task
    if (taskIntents.includes(intent)) {
      return 'task';
    }

    // Conversation Engine: General chat, greetings, queries
    return 'conversation';
  }
}
