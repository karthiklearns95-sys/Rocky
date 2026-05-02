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

    // FAST-PATH 1: Movement (Exact match or very close)
    if (lowerInput.includes('move to') || lowerInput.includes('go to') || lowerInput.includes('walk to')) {
      const positions = ['top left', 'top right', 'bottom left', 'bottom right', 'center'];
      for (const pos of positions) {
        if (lowerInput.includes(pos)) {
          intentResult.intent = 'move_position';
          intentResult.position = pos;
          return 'command';
        }
      }
      intentResult.intent = 'move_position';
      return 'command';
    }

    // FAST-PATH 2: Chrome (Priority App)
    if (lowerInput.includes('open chrome')) {
      intentResult.intent = 'open_chrome';
      // Simple regex for profile extraction
      const profileMatch = lowerInput.match(/profile\s+(.+)$/i);
      intentResult.profile = profileMatch ? profileMatch[1].trim() : 'karthikeya kumara 3';
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
