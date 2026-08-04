import { formatResponse, ROCKY_SYSTEM_PROMPT } from '#brain/personality/rockyPersonality.js';
import eventBus from '#services/eventBus.js';

/**
 * ConversationalSupervisor
 *
 * Routes user input between:
 *   - conversation: handled locally via LLM persona generation
 *   - execution:    delegated to AgentLoop
 *
 * Previously implemented as an XState state machine. Replaced with a plain
 * async class — XState added zero value here and introduced a hard dependency
 * that caused a startup crash when xstate was removed from package.json.
 *
 * Routing decision priority:
 *   1. semanticIntent.route (already determined by SemanticInterpreter upstream)
 *   2. Simple regex fast-path for self-intro / greeting patterns
 *   3. Autonomous presence triggers
 *   4. Default → execution
 */

// Patterns that always route to conversation mode regardless of SemanticInterpreter.
const SELF_GOAL_PATTERNS = [
  /^who\s+are\s+you/,
  /^what\s+(are|is)\s+you/,
  /^are\s+you\s+(a|an)?\s*(ai|robot|human)/,
  /^what\s+can\s+you\s+do/,
  /^introduce\s+yourself/,
  /^tell\s+(me\s+)?about\s+yourself/,
  /^hi\b/,
  /^hello\b/,
  /^hey\b/,
];

export default class ConversationalSupervisor {
  constructor(agentLoop, aiProvider) {
    this.agentLoop = agentLoop;
    this.aiProvider = aiProvider;
  }

  /**
   * Main entry point. Receives a (possibly JSON-serialised) semanticIntent and
   * dispatches to the correct handler. Fire-and-forget — callers must not await
   * this if they want non-blocking behaviour.
   *
   * @param {string} text - raw or JSON-stringified user input
   * @param {object|null} semanticIntent - structured intent from SemanticInterpreter
   */
  async processInput(text, semanticIntent = null) {
    try {
      const route = this._determineRoute(text, semanticIntent);

      if (route === 'conversation') {
        await this._handleConversation(text);
      } else {
        await this._handleExecution(text, semanticIntent);
      }
    } catch (err) {
      console.error('[ConversationalSupervisor] Unhandled error:', err);
      eventBus.emit('RESPONSE_READY', "Grace, Rocky had a small wobble. Rocky is okay. Try again?");
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Determine whether this input should be handled conversationally or
   * delegated to the execution agent.
   */
  _determineRoute(text, semanticIntent) {
    // 1. Trust the upstream SemanticInterpreter if it already classified this.
    if (semanticIntent?.route) {
      return semanticIntent.route;  // 'conversation' | 'execution'
    }

    // 2. Autonomous presence triggers are always conversational.
    if (text.startsWith('AUTONOMOUS_PRESENCE_TRIGGER:')) {
      return 'conversation';
    }

    // 3. Fast-path regex for common self-intro / greeting patterns.
    const lower = text.toLowerCase().trim();
    if (SELF_GOAL_PATTERNS.some(p => p.test(lower))) {
      return 'conversation';
    }

    // 4. Default: send to execution pipeline.
    return 'execution';
  }

  /**
   * Handle a conversational turn — generate a persona response via LLM and
   * emit it directly.
   */
  async _handleConversation(text) {
    let prompt;

    if (text.startsWith('AUTONOMOUS_PRESENCE_TRIGGER:')) {
      const msg = text.replace('AUTONOMOUS_PRESENCE_TRIGGER:', '').trim();
      prompt = `${ROCKY_SYSTEM_PROMPT}\n${msg}\nRocky:`;
    } else {
      prompt = `${ROCKY_SYSTEM_PROMPT}\nUser: ${text}\nRocky:`;
    }

    try {
      const resp = await this.aiProvider.generate(prompt);
      eventBus.emit('RESPONSE_READY', formatResponse(resp || "I'm Rocky. How can I help?"));
    } catch (err) {
      console.error('[ConversationalSupervisor] Conversation generation error:', err);
      eventBus.emit('RESPONSE_READY', formatResponse("Rocky had a think and got a bit lost. What were we talking about?"));
    }
  }

  /**
   * Delegate to the AgentLoop for actionable execution.
   * Responds immediately with an acknowledgement, then runs the loop in the
   * background so Rocky stays responsive.
   */
  async _handleExecution(text, semanticIntent) {
    const targetInput = semanticIntent ? JSON.stringify(semanticIntent) : text;

    console.log('[ConversationalSupervisor] Delegating actionable intent to AgentLoop...');

    // Acknowledge immediately so the UI doesn't appear frozen.
    eventBus.emit('RESPONSE_READY', "Got it. I'm on it.");

    // Run AgentLoop in the background (non-blocking).
    setImmediate(async () => {
      try {
        const result = await this.agentLoop.run(targetInput, { isBackground: true });
        if (result) {
          eventBus.emit('RESPONSE_READY', result);
        }
      } catch (err) {
        console.error('[ConversationalSupervisor] AgentLoop execution error:', err);
        eventBus.emit('RESPONSE_READY', "Rocky hit an execution error. Rocky is sorry.");
      }
    });
  }
}
