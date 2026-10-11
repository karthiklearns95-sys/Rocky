import { workflowCache } from '#memory/workflowCache.js';
import { rememberEpisode } from '../memoryHooks.js';
import { STATE, DEBUG_MODE } from '../constants.js';

/**
 * VALIDATE: did the step we just ran succeed? On success move to the next step (or finish and
 * remember the plan); on failure hand over to RECOVER.
 */
export async function handleValidateState(loop, ctx) {
  if (DEBUG_MODE) console.log(`[AgentLoop] State: VALIDATE`);

  // H2: Check abort signal — don't process validation if user interrupted
  if (ctx.signal?.aborted) {
    ctx.state = STATE.COMPLETE;
    ctx.directResponse = 'Stopped.';
    return;
  }

  const lastExecution = ctx.history[ctx.history.length - 1];

  if (lastExecution && lastExecution.result && lastExecution.result.success) {
    ctx.retryCount = 0;
    ctx.currentStepIndex++;

    if (ctx.currentStepIndex >= ctx.plan.length) {
      // Entire plan executed successfully!
      // 1. Cache in L1 (exact match)
      workflowCache.set(ctx.intentData.goal, ctx.intentData.entities, ctx.plan);
      // 2. Save in L2 (semantic RAG)
      loop.userMemory.saveMemory({ type: 'workflow', content: JSON.stringify(ctx.plan), confidence: 1.0 });
      rememberEpisode(ctx, 'ok');

      ctx.state = STATE.COMPLETE;
    } else {
      ctx.state = STATE.EXECUTE;
    }
  } else {
    // 🧠 9. FAILURE-AWARE MEMORY (Reduce confidence if retrieved workflow fails)
    loop.userMemory.adjustConfidence(JSON.stringify(ctx.plan), -0.2);
    ctx.state = STATE.RECOVER;
  }
}
