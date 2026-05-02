/**
 * AgentLoop — Unified execution loop for Rocky.
 *
 * Fixes:
 *  1. Real data flows between steps (placeholder resolution)
 *  2. Fast-paths integrated as plan steps, not early exits
 *  3. Single unified flow replaces 3 separate engines
 *  4. Planner receives cleaned intentData, not raw input
 *  5. Lean prompt with no brand-name examples
 *  6. Per-step error handling with retry and user feedback
 */

import eventBus from '../../controller/eventBus.js';
import { ROCKY_SYSTEM_PROMPT, formatResponse } from '../personality/rockyPersonality.js';

// ─────────────────────────────────────────────────
// Keyword-based fast-path rules (No LLM needed)
// ─────────────────────────────────────────────────
const POSITION_KEYWORDS = ['top left', 'top right', 'bottom left', 'bottom right', 'center'];
const MOVEMENT_TRIGGERS = ['move to', 'go to', 'walk to'];

function tryFastPath(intentData, rawInput) {
  const lower = rawInput.toLowerCase();

  // Fast-path: Movement
  if (MOVEMENT_TRIGGERS.some(t => lower.includes(t))) {
    const pos = POSITION_KEYWORDS.find(p => lower.includes(p));
    if (pos) {
      return [{ id: 'step_0', type: 'move', position: pos }];
    }
  }

  // Fast-path: Chrome
  if (lower.includes('open chrome')) {
    const profileMatch = lower.match(/profile\s+(.+)$/i);
    const profile = profileMatch ? profileMatch[1].trim() : 'karthikeya kumara 3';
    return [{ id: 'step_0', type: 'tool', toolName: 'openChromeProfile', args: { profileName: profile } }];
  }

  // Fast-path: Open App
  if (lower.match(/^(open|launch|start|run)\s+\w/i) && !lower.includes('chrome')) {
    const appMatch = lower.match(/(?:open|launch|start|run)\s+(.+)/i);
    if (appMatch) {
      return [{ id: 'step_0', type: 'tool', toolName: 'openApp', args: { appName: appMatch[1].trim() } }];
    }
  }

  return null; // No fast-path matched
}

// ─────────────────────────────────────────────────
// Resolve {{step_N_result}} placeholders in args
// ─────────────────────────────────────────────────
function resolvePlaceholders(args, results) {
  const str = JSON.stringify(args);
  const resolved = str.replace(/\{\{(step_\d+)_result\}\}/g, (_, stepId) => {
    return results[stepId] || '';
  });
  try {
    return JSON.parse(resolved);
  } catch {
    return args;
  }
}

// ─────────────────────────────────────────────────
// Convert planner output to normalized step list
// ─────────────────────────────────────────────────
function normalizePlanSteps(planResult) {
  if (!planResult?.toolCalls?.length) {
    return [{ id: 'step_0', type: 'conversation' }];
  }
  return planResult.toolCalls.map((call, i) => ({
    id: `step_${i}`,
    type: 'tool',
    toolName: call.toolName,
    args: call.args || {}
  }));
}

// ─────────────────────────────────────────────────
// Main Agent Loop
// ─────────────────────────────────────────────────
export default class AgentLoop {
  constructor(intentParser, planner, toolManager, aiProvider) {
    this.intentParser = intentParser;
    this.planner = planner;
    this.toolManager = toolManager;
    this.aiProvider = aiProvider;
  }

  async run(rawInput) {
    console.log(`\n--- [AgentLoop] Starting for: "${rawInput}" ---`);

    // ── 1. Parse Intent (FIX 4: clean intentData passed to planner) ──
    const intentData = await this.intentParser.parse(rawInput);
    intentData.rawInput = rawInput;
    console.log(`[AgentLoop] Intent: ${intentData.intent} | Confidence: ${intentData.confidence}`);

    // ── 2. Guard: Autonomous presence triggers are ALWAYS conversation-only ──
    if (rawInput.startsWith('AUTONOMOUS_PRESENCE_TRIGGER')) {
      console.log(`[AgentLoop] Presence trigger detected — forcing conversation mode`);
      const steps = [{ id: 'step_0', type: 'conversation' }];
      const ctx = { intentData, results: { step_0: 'conversation_only' }, errors: [], toolOutputs: [{ step: 'step_0', status: 'success', data: 'conversation' }] };
      return await this._formatResponse(intentData, ctx);
    }

    // ── 3. Try keyword fast-paths first (FIX 2: fast-path as steps, not exits) ──
    let steps = tryFastPath(intentData, rawInput);

    if (!steps) {
      // ── 4. Planner (FIX 4: pass intentData, NOT rawInput) ──
      const planResult = await this.planner.createPlan(intentData);
      steps = normalizePlanSteps(planResult);
    }

    console.log(`[AgentLoop] Executing ${steps.length} step(s): ${steps.map(s => s.toolName || s.type).join(' → ')}`);

    // ── 4. Execution context (FIX 1: real results accumulate here) ──
    const ctx = {
      intentData,
      results: {},
      errors: [],
      toolOutputs: []
    };

    // ── 5. Step-by-step execution loop (FIX 6: per-step error handling) ──
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Handle movement steps directly (no tool needed)
      if (step.type === 'move') {
        console.log(`[AgentLoop] Moving Rocky to: ${step.position}`);
        eventBus.emit('MOVE_AGENT', step.position);
        ctx.results[step.id] = `Moved to ${step.position}`;
        ctx.toolOutputs.push({ step: step.id, status: 'success', data: ctx.results[step.id] });
        continue;
      }

      // Handle pure conversation (no tools)
      if (step.type === 'conversation') {
        ctx.results[step.id] = 'conversation_only';
        ctx.toolOutputs.push({ step: step.id, status: 'success', data: 'conversation' });
        continue;
      }

      // Resolve placeholders from previous results (FIX 1)
      const resolvedArgs = resolvePlaceholders(step.args || {}, ctx.results);

      console.log(`[AgentLoop] Step ${i + 1}/${steps.length}: ${step.toolName} | Args: ${JSON.stringify(resolvedArgs)}`);

      let retries = 0;
      let success = false;

      while (retries < 2 && !success) {
        try {
          const result = await this.toolManager.execute(step.toolName, resolvedArgs);
          ctx.results[step.id] = result;
          ctx.toolOutputs.push({ step: step.id, tool: step.toolName, status: 'success', data: result });
          success = true;
          console.log(`[AgentLoop] Step ${step.id} ✅ completed`);
        } catch (err) {
          retries++;
          console.warn(`[AgentLoop] Step ${step.id} ❌ failed (attempt ${retries}): ${err.message}`);
          if (retries >= 2) {
            const errorMsg = `Grace… Rocky had trouble with "${step.toolName}". Shall I try again?`;
            ctx.errors.push({ step: step.id, error: err.message });
            ctx.results[step.id] = errorMsg;
            ctx.toolOutputs.push({ step: step.id, tool: step.toolName, status: 'failed', data: errorMsg });
          }
        }
      }
    }

    // ── 6. Generate final response (FIX 3: single unified formatting) ──
    const response = await this._formatResponse(intentData, ctx);
    console.log(`[AgentLoop] Final Response: "${response}"`);
    return response;
  }

  async _formatResponse(intentData, ctx) {
    // If it was a movement, respond briefly
    if (intentData.intent === 'move_position' && ctx.errors.length === 0) {
      return formatResponse(`Rocky is moving to the position. Amaze.`);
    }

    const toolSummary = ctx.toolOutputs
      .map(o => `${o.tool || o.step}: ${typeof o.data === 'string' ? o.data.substring(0, 150) : JSON.stringify(o.data)}`)
      .join('\n');

    const isConversation = ctx.toolOutputs.every(o => o.data === 'conversation' || o.data === 'conversation_only');

    const prompt = `${ROCKY_SYSTEM_PROMPT}

---

Context (DO NOT repeat these labels in your response):
- What the user wanted: "${intentData.rawInput}"
${isConversation ? '' : `- What Rocky did:\n${toolSummary}`}

Now respond as Rocky in 1-2 sentences. Do NOT echo the above labels. Just talk naturally as Rocky.
${isConversation ? 'Ask a short follow-up if appropriate.' : 'Mention what was done and add Rocky\'s personality flair.'}
    `.trim();

    try {
      const rawText = await this.aiProvider.generate(prompt);
      return formatResponse(rawText);
    } catch {
      return formatResponse("Grace, Rocky finished the task. Amaze.");
    }
  }
}
