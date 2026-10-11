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

/**
 * Input that is not an interpreter intent (the interpreter failed, or plain text came in) used to
 * leave ctx.intentData null, and PLAN crashed reading intentData.goal. Treat it as an automation
 * request about her sentence instead (the loop's default domain). The goal is a slug of what she
 * said, not one shared name, because the plan cache is keyed by goal: a shared goal would replay
 * one request's plan for every other plain-text request.
 */
export function ensureIntent(ctx, rawInput) {
  if (ctx.intentData) return;
  const goal = String(ctx.userText).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'user_request';
  ctx.intentData = { goal, entities: {}, domain: 'automation', actionable: true, route: 'execution', rawInput };
}
