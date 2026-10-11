import { STATE } from './constants.js';
import { userTextOf } from '../planUtils.js';

/** The working state of one run through the state machine. */
export function createContext({ rawInput, options, signal, activeWindow, ragContext, graphContext }) {
  return {
    rawInput,
    userText: userTextOf(rawInput),   // her words, never the interpreter's JSON
    options,
    signal,        // C1: Store signal on context so tools can read it via currentArgs._signal
    stepCount: 0,
    retryCount: 0,
    state: STATE.PLAN,
    activeWindow: activeWindow,
    ragContext: ragContext,
    graphContext: graphContext,
    intentData: null,
    domain: null,
    plan: [],
    currentStepIndex: 0,
    uiMap: null,
    uiMapSource: null,
    uiMapChecked: false,
    history: []
  };
}

/**
 * C4: If rawInput is already a valid JSON intent from SemanticInterpreter, pre-parse it.
 * This skips the redundant IntentParser LLM call for semantic-routed commands.
 */
export function applyPreparsedIntent(ctx, rawInput) {
  try {
    const prearsed = JSON.parse(rawInput);
    if (prearsed && prearsed.goal && prearsed.entities) {
      ctx.intentData = {
        ...prearsed,
        domain: prearsed.domain || 'automation',
        actionable: prearsed.actionable !== undefined ? prearsed.actionable : true,
        route: 'execution',
        rawInput
      };
      // Apply rule overrides post-parse
      const isConversational = ['chat', 'greeting', 'identify_self', 'self_intro', 'recall_personal_memory'].includes(prearsed.goal);
      if (isConversational) {
        ctx.intentData.domain = 'conversation';
        ctx.intentData.actionable = false;
        ctx.intentData.route = 'conversation';
      }
    }
  } catch {
    // Not JSON — will be parsed by IntentParser in PLAN state as normal
  }
}
