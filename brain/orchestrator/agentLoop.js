import eventBus from '../../controller/eventBus.js';
import { ROCKY_SYSTEM_PROMPT, formatResponse } from '../personality/rockyPersonality.js';
import getActiveWindow from '../../executor/system/getActiveWindow.js';
import VisionHandler from '../vision/visionHandler.js';
import CorrectionHandler from '../learning/correctionHandler.js';
import { workflowCache } from '../../memory/workflowCache.js';
import UserMemory from '../../memory/userMemory.js';
import { extractFacts } from '../../memory/factExtractor.js';

const STATE = {
  PLAN: 'PLAN',
  EXECUTE: 'EXECUTE',
  VALIDATE: 'VALIDATE',
  RECOVER: 'RECOVER',
  COMPLETE: 'COMPLETE'
};

const DEBUG_MODE = true;

/**
 * AgentLoop - Dynamic State Machine Orchestrator
 */
export default class AgentLoop {
  constructor(intentParser, planner, toolManager, aiProvider, appActionMapper) {
    this.intentParser = intentParser;
    this.planner = planner; // This is now WorkflowPlanner
    this.toolManager = toolManager;
    this.aiProvider = aiProvider;
    this.appActionMapper = appActionMapper;
    
    this.vision = new VisionHandler(aiProvider, toolManager);
    this.learning = new CorrectionHandler(aiProvider, appActionMapper);
    this.userMemory = new UserMemory(aiProvider);
    
    this.MAX_STEPS = 6;
    this.RETRY_LIMIT = 2;

    if (DEBUG_MODE) {
      console.log("[AgentLoop] DEBUG MODE ENABLED.");
      console.log("[AgentLoop] Available tools:", toolManager.list().join(', '));
    }
  }

  async run(rawInput) {
    if (DEBUG_MODE) console.log(`\n--- [AgentLoop] Starting State Machine for: "${rawInput}" ---`);
    
    // Bypass 1: Autonomous presence trigger
    if (rawInput.startsWith('AUTONOMOUS_PRESENCE_TRIGGER:')) {
      const message = rawInput.replace('AUTONOMOUS_PRESENCE_TRIGGER:', '').trim();
      const resp = await this.aiProvider.generate(`${ROCKY_SYSTEM_PROMPT}\n${message}\nRocky:`);
      return formatResponse(resp || "Hey Grace... just checking in.");
    }

    // ⚡ 1. FAST PATH
    const fastAction = this._fastIntentHandler(rawInput);
    if (fastAction) {
      if (DEBUG_MODE) console.log(`[AgentLoop] ⚡ Fast Path Hit:`, fastAction);
      await this.toolManager.execute(fastAction.tool, fastAction.args);
      return formatResponse(`Rocky executed ${fastAction.tool}. Amaze.`);
    }

    // ⚡ 9. PARALLEL INIT (Retrieve Context + Get Window)
    const [activeWindow, ragContext] = await Promise.all([
      getActiveWindow(),
      this.userMemory.retrieveRelevantContext(rawInput)
    ]);

    // Passive Fact Extraction (Non-blocking)
    extractFacts(rawInput, this.aiProvider).then((res) => {
      if (res && res.facts && res.facts.length > 0) {
        res.facts.forEach(f => {
          this.userMemory.saveMemory({
            type: 'fact',
            content: `${f.subject} ${f.relation} is ${f.object}`,
            confidence: f.confidence
          });
        });
      }
    }).catch(() => {});

    let ctx = {
      rawInput,
      stepCount: 0,
      retryCount: 0,
      state: STATE.PLAN,
      activeWindow: activeWindow,
      ragContext: ragContext,
      intentData: null,
      plan: [],
      currentStepIndex: 0,
      history: []
    };

    while (ctx.state !== STATE.COMPLETE && ctx.stepCount < this.MAX_STEPS) {
      ctx.stepCount++;
      // Only refresh active window if executing
      if (ctx.state !== STATE.PLAN) {
        ctx.activeWindow = await getActiveWindow();
      }

      switch (ctx.state) {
        case STATE.PLAN:
          await this._handlePlanState(ctx);
          break;
        case STATE.EXECUTE:
          await this._handleExecuteState(ctx);
          break;
        case STATE.VALIDATE:
          await this._handleValidateState(ctx);
          break;
        case STATE.RECOVER:
          await this._handleRecoverState(ctx);
          break;
      }
    }

    if (ctx.state !== STATE.COMPLETE) {
      return formatResponse("Grace... Rocky tried hard but couldn't finish the workflow.");
    }

    if (ctx.directResponse) return formatResponse(ctx.directResponse);

    return await this._generateFinalResponse(ctx);
  }

  _fastIntentHandler(input) {
    const lower = input.toLowerCase().trim();
    // No chaining allowed in fast path
    if (lower.includes(' and ') || lower.includes(' then ')) return null;

    if (lower.includes('volume up'))   return { tool: 'systemControl', args: { action: 'volume up' } };
    if (lower.includes('volume down')) return { tool: 'systemControl', args: { action: 'volume down' } };
    if (lower.includes('mute'))        return { tool: 'systemControl', args: { action: 'mute' } };
    if (lower.includes('screenshot'))  return { tool: 'takeScreenshot', args: {} };

    const mediaCommands = ['play', 'pause', 'next', 'previous', 'skip', 'resume'];
    if (mediaCommands.includes(lower) || lower === 'play music' || lower === 'pause music') {
       return { tool: 'pressKey', args: { key: lower.includes('next') ? '{MEDIA_NEXT}' : lower.includes('prev') ? '{MEDIA_PREV}' : '{MEDIA_PLAY_PAUSE}' } };
    }

    return null;
  }

  async _handlePlanState(ctx) {
    if (DEBUG_MODE) console.log(`[AgentLoop] State: PLAN`);
    
    // Format RAG context for prompts
    let ragString = "";
    if (ctx.ragContext.facts.length > 0 || ctx.ragContext.workflows.length > 0) {
      ragString = "\n\nRelevant user knowledge:\n";
      if (ctx.ragContext.facts.length > 0) ragString += `Facts:\n- ${ctx.ragContext.facts.join('\n- ')}\n`;
      if (ctx.ragContext.workflows.length > 0) ragString += `Past Workflows:\n- ${ctx.ragContext.workflows.map(w => JSON.stringify(w)).join('\n- ')}\n`;
    }

    // ⚙️ 2. LIGHT PATH (Parse Goal + Entities)
    ctx.intentData = await this.intentParser.parse(ctx.rawInput + ragString);
    
    if (ctx.intentData.route === "conversation") {
       if (DEBUG_MODE) console.log(`[AgentLoop] Routed to CONVERSATION.`);
       const resp = await this.aiProvider.generate(`${ROCKY_SYSTEM_PROMPT}${ragString}\nUser: ${ctx.rawInput}\nRocky:`, { stream: true });
       ctx.directResponse = resp;
       ctx.state = STATE.COMPLETE;
       return;
    }

    // 🧠 7. WORKFLOW CACHE (L1 Cache)
    const cachedPlan = workflowCache.get(ctx.intentData.goal, ctx.intentData.entities);
    if (cachedPlan) {
      if (DEBUG_MODE) console.log(`[AgentLoop] 🔁 L1 Cache Hit for: ${ctx.intentData.goal}`);
      ctx.plan = cachedPlan;
      ctx.state = STATE.EXECUTE;
      return;
    }

    // 🧠 4. WORKFLOW PLANNER (L2/Heavy Path)
    // Pass ragString to planner to reuse past successful workflows
    const planResponse = await this.planner.createPlan(ctx.intentData.goal, ctx.intentData.entities, ctx.history, 1, ragString);
    ctx.plan = planResponse.steps || [];

    if (!ctx.plan || ctx.plan.length === 0) {
      if (DEBUG_MODE) console.log(`[AgentLoop] Invalid or empty plan generated.`);
      ctx.directResponse = "Grace, I couldn't figure out the steps to do that. Can you rephrase?";
      ctx.state = STATE.COMPLETE;
    } else {
      ctx.state = STATE.EXECUTE;
    }
  }

  async _handleExecuteState(ctx) {
    if (DEBUG_MODE) console.log(`[AgentLoop] State: EXECUTE (Step ${ctx.currentStepIndex + 1}/${ctx.plan.length})`);
    const currentStep = ctx.plan[ctx.currentStepIndex];
    
    if (!currentStep.tool || !this.toolManager.has(currentStep.tool)) {
      ctx.history.push({ action: 'fail', error: `Invalid tool hallucinated: ${currentStep.tool}` });
      ctx.state = STATE.RECOVER;
      return;
    }

    let currentArgs = currentStep.input || {};

    // Variable injection ($LAST_OUTPUT)
    const lastResult = ctx.history.length > 0 ? ctx.history[ctx.history.length - 1].result : null;
    if (lastResult && currentArgs) {
      currentArgs = JSON.parse(JSON.stringify(currentArgs));
      for (let key in currentArgs) {
        let val = currentArgs[key];
        if (typeof val !== 'string') continue;
        if (val === '$LAST_OUTPUT') {
          currentArgs[key] = lastResult.data ?? lastResult;
          continue;
        }
        const variableRegex = /\$LAST_OUTPUT(\.[\w.]+)?/g;
        currentArgs[key] = val.replace(variableRegex, (match) => {
          if (match === '$LAST_OUTPUT') return JSON.stringify(lastResult.data ?? lastResult);
          const path = match.replace('$LAST_OUTPUT.', '').split('.');
          let resolved = lastResult.data ?? lastResult;
          for (const part of path) resolved = resolved && typeof resolved === 'object' ? resolved[part] : undefined;
          return resolved !== undefined ? (typeof resolved === 'object' ? JSON.stringify(resolved) : resolved) : match;
        });
      }
    }

    if (DEBUG_MODE) {
      console.log(`[AgentLoop] Executing Tool: ${currentStep.tool}`);
      console.log(`[AgentLoop] Input Args:`, currentArgs);
    }

    // Global Resource Execution Pipeline
    if (currentArgs.query && currentStep.tool === 'open_resource') {
      const resolveResource = (await import('../../resolver/resourceResolver.js')).default;
      const resolveCapabilities = (await import('../../resolver/capabilityResolver.js')).default;
      
      const resource = await resolveResource(currentArgs.query, ctx, this.appActionMapper);
      
      if (resource.type === 'unknown') {
         if (DEBUG_MODE) console.log(`[AgentLoop] Unknown resource requested. Asking user.`);
         ctx.history.push({ action: 'fail', error: `Unknown resource: ${currentArgs.query}` });
         ctx.directResponse = `Grace, I'm not sure what "${currentArgs.query}" is. Is it a desktop app or a website?`;
         ctx.state = STATE.COMPLETE;
         return;
      }
      
      const capabilities = resolveCapabilities(resource);
      currentArgs.resource = resource;
      currentArgs.capabilities = capabilities;
      
      if (DEBUG_MODE) console.log(`[AgentLoop] Resolved Resource:`, resource, `\nCapabilities:`, capabilities);
    }

    // Strict pre-execution contract for open_resource
    if (currentStep.tool === 'open_resource' && !currentArgs.resource) {
      const errMsg = 'open_resource called without a resolved resource object.';
      console.error(`[AgentLoop] CONTRACT VIOLATION: ${errMsg}`);
      ctx.history.push({ action: 'fail', error: errMsg });
      ctx.state = STATE.RECOVER;
      return;
    }

    // Performance Optimization: Check Cache
    const cacheKey = `${ctx.activeWindow?.appName}_${currentStep.tool}_${JSON.stringify(currentArgs)}`;
    if (this.actionCache && this.actionCache[cacheKey]) {
      if (DEBUG_MODE) console.log(`[AgentLoop] Using cached execution for ${currentStep.tool}`);
      currentArgs = this.actionCache[cacheKey]; // Inject known working coords/args
    }

    // TRUE VALIDATION LOOP: Pre-action screenshot
    const { captureTempScreenshot, compareScreenshots } = await import('../../tools/system/verifyExecution.js');
    const beforeImg = await captureTempScreenshot(`before_${Date.now()}.png`);

    const result = await this.toolManager.execute(currentStep.tool, currentArgs);
    
    // TRUE VALIDATION LOOP: Post-action screenshot
    await new Promise(r => setTimeout(r, 500));
    const afterImg = await captureTempScreenshot(`after_${Date.now()}.png`);
    
    // Verify changes
    const validation = await compareScreenshots(beforeImg, afterImg);
    if (DEBUG_MODE) console.log(`[AgentLoop] Validation Check:`, validation);
    
    if (!validation.changed && currentStep.tool === 'mouseClick') {
       if (DEBUG_MODE) console.log(`[AgentLoop] True Validation Failed: UI did not change.`);
       result.success = false;
       result.error = 'UI unchanged after click.';
    } else if (result.success) {
       // Cache success
       this.actionCache = this.actionCache || {};
       this.actionCache[cacheKey] = currentArgs;
    }

    ctx.history.push({
      tool: currentStep.tool,
      args: currentArgs,
      result: result
    });

    ctx.state = STATE.VALIDATE;
  }

  async _handleValidateState(ctx) {
    if (DEBUG_MODE) console.log(`[AgentLoop] State: VALIDATE`);
    const lastExecution = ctx.history[ctx.history.length - 1];

    if (lastExecution && lastExecution.result && lastExecution.result.success) {
      ctx.retryCount = 0;
      ctx.currentStepIndex++;
      
      if (ctx.currentStepIndex >= ctx.plan.length) {
        // Entire plan executed successfully! 
        // 1. Cache in L1 (exact match)
        workflowCache.set(ctx.intentData.goal, ctx.intentData.entities, ctx.plan);
        // 2. Save in L2 (semantic RAG)
        this.userMemory.saveMemory({ type: 'workflow', content: JSON.stringify(ctx.plan), confidence: 1.0 });
        
        ctx.state = STATE.COMPLETE;
      } else {
        ctx.state = STATE.EXECUTE;
      }
    } else {
      // 🧠 9. FAILURE-AWARE MEMORY (Reduce confidence if retrieved workflow fails)
      this.userMemory.adjustConfidence(JSON.stringify(ctx.plan), -0.2);
      ctx.state = STATE.RECOVER;
    }
  }

  async _handleRecoverState(ctx) {
    if (DEBUG_MODE) console.log(`[AgentLoop] State: RECOVER (Retry ${ctx.retryCount}/${this.RETRY_LIMIT})`);
    const lastExecution = ctx.history[ctx.history.length - 1] || {};

    if (ctx.retryCount < this.RETRY_LIMIT) {
      ctx.retryCount++;
      
      if (lastExecution.error && lastExecution.error.includes("Invalid tool")) {
        if (DEBUG_MODE) console.log(`[AgentLoop] Smart Recovery: Invalid tool detected. Re-planning with constraint...`);
        const constraint = `The previous plan failed because it used an invalid tool "${lastExecution.tool}". You MUST pick a strictly valid tool from the provided list.`;
        
        const availableTools = Object.keys(this.toolManager.tools).join(', ');
        const planResponse = await this.planner.createPlan(ctx.intentData, ctx.history, availableTools, constraint);
        
        if (planResponse.steps && planResponse.steps.length > 0) {
           ctx.plan = planResponse.steps;
           ctx.currentStepIndex = 0; // Restart execution with new plan
           ctx.state = STATE.EXECUTE;
           return;
        }
      }

      if (DEBUG_MODE) console.log(`[AgentLoop] Retrying tool ${lastExecution.tool}...`);
      
      // If it was a click failure, try using Vision explicitly (Alternate Tool fallback)
      if (lastExecution.tool === 'mouseClick') {
         if (DEBUG_MODE) console.log(`[AgentLoop] Fallback: Engaging Vision for click...`);
         const visionResult = await this.toolManager.execute('locateUIElement', { description: ctx.intentData.rawInput });
         if (visionResult && visionResult.x >= 0) {
           ctx.plan[ctx.currentStepIndex].input = { x: visionResult.x, y: visionResult.y };
         }
      }

      ctx.state = STATE.EXECUTE;
    } else {
      if (DEBUG_MODE) console.log(`[AgentLoop] Recovery failed after ${this.RETRY_LIMIT} attempts. Asking user.`);
      ctx.history.push({ action: 'fail', error: 'Max retries reached.' });
      ctx.directResponse = "Grace, I encountered a snag and couldn't figure out a workaround.";
      ctx.state = STATE.COMPLETE;
    }
  }

  async _generateFinalResponse(ctx) {
    const summary = ctx.history.map(h => `${h.tool || h.action}: ${h.result ? (h.result.success ? 'Done' : 'Fail') : 'Done'}`).join(', ');
    const prompt = `${ROCKY_SYSTEM_PROMPT}\n\nTask: ${ctx.rawInput}\nSummary: ${summary}\n\nRespond briefly.`;
    const resp = await this.aiProvider.generate(prompt);
    return formatResponse(resp || "Rocky finished. Amaze.");
  }
}
