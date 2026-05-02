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

    // Safety: keyword-based routing regardless of parsed intent
    if (lowerInput.includes('open ') || lowerInput.includes('launch ')) {
      return 'command';
    }
    // Safety: movement commands must always hit CommandEngine
    if (lowerInput.includes('move to') || lowerInput.includes('go to') || lowerInput.includes('walk to')) {
      // Inject the position into intentResult if AI missed it
      if (!intentResult.position) {
        const positions = ['top left', 'top right', 'bottom left', 'bottom right', 'center'];
        for (const pos of positions) {
          if (lowerInput.includes(pos)) {
            intentResult.position = pos;
            break;
          }
        }
      }
      intentResult.intent = 'move_position';
      return 'command';
    }

    const commandIntents = ['take_screenshot', 'open_app', 'system_control', 'file_manage', 'move_position'];
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
