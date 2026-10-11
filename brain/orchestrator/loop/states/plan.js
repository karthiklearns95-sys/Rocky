import process from 'process';
import { ROCKY_SYSTEM_PROMPT } from '#brain/personality/rockyPersonality.js';
import { workflowCache } from '#memory/workflowCache.js';
import { buildPlannerContext } from '#memory/contextManager.js';
import { semanticRouter } from '../../semanticRouter.js';
import { withGuard } from '../../../runtime/executionGuard.js';
import { sanitizePlan } from '../planSanitizer.js';
import { STATE, DEBUG_MODE } from '../constants.js';

/**
 * PLAN: decide what kind of request this is and either answer it directly (conversation, research)
 * or produce the list of steps to carry out (router -> cached plan -> LLM planner).
 */
export async function handlePlanState(loop, ctx, signal) {
  if (signal?.aborted) return;
  if (DEBUG_MODE) console.log(`[AgentLoop] State: PLAN`);

  const ragString = formatMemoryContext(ctx);

  // 🧠 2. DOMAIN LOCK
  if (!ctx.domain) {
    // ctx.intentData is guaranteed to exist now via SemanticInterpreter
    ctx.domain = ctx.intentData?.domain || 'automation';
    if (DEBUG_MODE) console.log(`[AgentLoop] 🔒 Domain Locked: ${ctx.domain}`);
  }

  if (ctx.domain === "conversation") return answerInPersona(loop, ctx, ragString);
  if (ctx.domain === "research") return answerWithResearch(loop, ctx);

  if (DEBUG_MODE) console.log(`[AgentLoop] Automation Branch (Goal: ${ctx.intentData.goal}).`);
  await planAutomation(loop, ctx);
}

/** What Rocky remembers about the user, formatted for a prompt. */
export function formatMemoryContext(ctx) {
  let ragString = "";
  if (ctx.ragContext.facts.length > 0 || ctx.ragContext.workflows.length > 0) {
    ragString = "\n\nRelevant user knowledge:\n";
    if (ctx.ragContext.facts.length > 0) ragString += `Facts:\n- ${ctx.ragContext.facts.join('\n- ')}\n`;
    if (ctx.ragContext.workflows.length > 0) ragString += `Past Workflows:\n- ${ctx.ragContext.workflows.map(w => JSON.stringify(w)).join('\n- ')}\n`;
  }
  if (ctx.graphContext && ctx.graphContext.length > 0) {
    ragString += `${ragString ? '\n' : '\n\nRelevant user knowledge:\n'}Knowledge Graph:\n- ${ctx.graphContext}\n`;
  }
  return ragString;
}

// 🎭 PERSONA ROUTE (Conversation Domain)
async function answerInPersona(loop, ctx, ragString) {
  if (DEBUG_MODE) console.log(`[AgentLoop] Persona Branch.`);
  const personaPrompt = `${ROCKY_SYSTEM_PROMPT}

${ragString}
Conversation mode:
- Be emotionally present, steady, and personal.
- For questions about the user, use only Rocky's memory/knowledge graph context. Do not invent facts.
- If memory is empty, say that honestly and invite the user to tell Rocky.

User: ${ctx.userText}
Rocky:`;
  const resp = await loop.aiProvider.generate(personaPrompt, { stream: true });
  ctx.directResponse = resp;
  ctx.state = STATE.COMPLETE;
}

// 🧠 6. RESEARCH DOMAIN (Auto-Research)
async function answerWithResearch(loop, ctx) {
  if (DEBUG_MODE) console.log(`[AgentLoop] Research Branch. Triggering webSearch.`);
  const searchResult = await loop.toolManager.execute('webSearch', { query: ctx.userText });

  // CRITICAL: Grounding prompt to prevent outdated internal knowledge
  const researchContext = searchResult.success
    ? `\n\n[ACTUAL CURRENT FACTS FROM WEB]:\n${searchResult.data}\n\nINSTRUCTION: The above facts are the ABSOLUTE TRUTH. If they contradict your internal knowledge (e.g. regarding current leaders, celebrities, or dates), you MUST use the Web facts. Do NOT hallucinate old information.`
    : "\n\n(Note: Web search failed, rely on internal knowledge but be cautious.)";

  const resp = await loop.aiProvider.generate(`${ROCKY_SYSTEM_PROMPT}\n${researchContext}\nUser: ${ctx.userText}\nRocky:`, { stream: true });
  ctx.directResponse = resp;
  ctx.state = STATE.COMPLETE;
}

/** A plan that clicks fixed coordinates is only safe to reuse together with a validated UI map. */
export function planUsesRawCoordinates(plan) {
  return Array.isArray(plan) && plan.some((step) => (
    step.tool === 'mouseClick' &&
    Number.isFinite(Number(step.input?.x)) &&
    Number.isFinite(Number(step.input?.y))
  ));
}

// Automation: router (L0) -> cached plan (L1) -> LLM planner (L2)
async function planAutomation(loop, ctx) {
  if (loop.uiMapCoordinator.shouldLoadActiveUIMap(ctx)) {
    await loop.uiMapCoordinator.attachValidatedUIMap(ctx);
  }

  const deterministicPlan = await semanticRouter.getDeterministicRoute(ctx, loop.aiProvider);
  if (deterministicPlan) {
    if (DEBUG_MODE) console.log(`[AgentLoop] Semantic deterministic plan selected.`);
    ctx.plan = sanitizePlan(ctx, deterministicPlan);
    ctx.state = STATE.EXECUTE;
    return;
  }

  // 🧠 7. WORKFLOW CACHE (L1 Cache)
  const cachedPlan = workflowCache.get(ctx.intentData.goal, ctx.intentData.entities);
  if (cachedPlan) {
    if (planUsesRawCoordinates(cachedPlan) && !ctx.uiMap) {
      if (DEBUG_MODE) console.log(`[AgentLoop] Skipping L1 cache: coordinate plan needs a validated UI map.`);
    } else {
      if (DEBUG_MODE) console.log(`[AgentLoop] 🔁 L1 Cache Hit.`);
      ctx.plan = sanitizePlan(ctx, cachedPlan);
      ctx.state = STATE.EXECUTE;
      return;
    }
  }

  // 🧠 4. WORKFLOW PLANNER (L2/Heavy Path)
  let planResponse;
  const basePrompt = ctx.options?.isFollowUp && ctx.options?.lastContextWindow
      ? `[FOLLOW-UP: User is continuing task on '${ctx.options.lastContextWindow}']. ${ctx.userText}`
      : ctx.userText;
  const strictContext = await buildPlannerContext(basePrompt, ctx.sessionId, loop.aiProvider);
  try {
    process.emit('aura_telemetry', { status: 'thinking', source: 'L2_Planner' });
    planResponse = await withGuard(
      loop.planner.createPlan(ctx.intentData.goal, ctx.intentData.entities, [], 1, strictContext, ctx.uiMap || {}),
      ctx.signal,
      'planner'
    );
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    planResponse = { steps: [] };
  }

  ctx.plan = sanitizePlan(ctx, planResponse.steps || []);

  if (!ctx.plan || ctx.plan.length === 0) {
    if (DEBUG_MODE) console.log(`[AgentLoop] Invalid or empty plan generated.`);
    ctx.directResponse = "Grace, I couldn't figure out the steps to do that. Can you rephrase?";
    ctx.state = STATE.COMPLETE;
  } else {
    ctx.state = STATE.EXECUTE;
  }
}
