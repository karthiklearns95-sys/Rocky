import { ROCKY_SYSTEM_PROMPT, formatResponse } from '#brain/personality/rockyPersonality.js';
import eventBus from '#services/eventBus.js';
import getActiveWindow from '../../automation/system/getActiveWindow.js';
import { workflowCache } from '#memory/workflowCache.js';
import UserMemory from '#memory/userMemory.js';
import { graphManager } from '#memory/graphManager.js';
import { extractFacts } from '#memory/factExtractor.js';
import { semanticRouter } from './semanticRouter.js';
import { buildPlannerContext } from '#memory/contextManager.js';
import { delegationManager } from './delegationManager.js';
import voiceController from '#voice/voiceController.js';
import { withGuard } from '../runtime/executionGuard.js';
import process from 'process';
import {
  findElementInMap,
  recordUIMapFailure,
  recordUIMapSuccess,
  saveUIMap,
} from '#memory/uiMapStore.js';
import { captureUIVisualSignature } from '#tools/system/uiVisualSignature.js';
import { ClickResolver } from './clickResolver.js';
import { UIMapCoordinator } from './uiMapCoordinator.js';
import { inferAppName, extractTextToType, extractSearchText, extractMathExpression } from './planUtils.js';
import { execWithTimeout } from '../../automation/system/execWithTimeout.js';

const STATE = {
  PLAN: 'PLAN',
  EXECUTE: 'EXECUTE',
  VALIDATE: 'VALIDATE',
  RECOVER: 'RECOVER',
  COMPLETE: 'COMPLETE'
};

const DEBUG_MODE = process.env.NODE_ENV !== 'production';

const DOMAIN_TOOLS = {
  automation: [
    "open_resource",
    "waitForAppReady",
    "typeText",
    "mouseClick",
    "pressKey",
    "scroll",
    "locateUIElement",
    "analyze_ui",
    "calculate",
    "systemControl",
    "focusWindow",
    "ocrSearch",
    "browserOpen",
    "browserClick",
    "browserType",
    "browserRead",
    "desktopClick",
    "desktopType"
  ],
  research: [
    "webSearch",
    "fetchAPI",
    "openURL"
  ],
  conversation: []
};

/**
 * AgentLoop - Dynamic State Machine Orchestrator
 */
export default class AgentLoop {
  constructor(planner, toolManager, aiProvider, appActionMapper) {
    this.planner = planner;
    this.toolManager = toolManager;
    this.aiProvider = aiProvider;
    this.appActionMapper = appActionMapper;

    this.userMemory = new UserMemory(aiProvider);

    // Collaborator classes — extracted from this file
    this.clickResolver = new ClickResolver(toolManager);
    this.uiMapCoordinator = new UIMapCoordinator(toolManager);

    this.MAX_STEPS = 60;
    this.RETRY_LIMIT = 2;

    // ActionCache: bounded by size and TTL to prevent unbounded growth
    this.actionCache = {};
    this._actionCacheTimestamps = {};

    if (DEBUG_MODE) {
      console.log("[AgentLoop] DEBUG MODE ENABLED.");
      console.log("[AgentLoop] Available tools:", toolManager.list().join(', '));
    }

    this.isBusy = false;
    this.backgroundQueue = [];

    // Dynamically inject Initiative Engine to observe the OS
    import('./initiativeEngine.js').then(({ initiativeEngine }) => {
        initiativeEngine.start(this);
    }).catch(() => {
        if (DEBUG_MODE) console.warn('[AgentLoop] Initiative Engine not loaded.');
    });

    eventBus.on('WORKER_TASK_COMPLETE', (payload) => {
        console.log(`[AgentLoop] Background worker finished task: ${payload.trigger || payload.prompt}`);
        import('#voice/voiceController.js').then(({ default: voiceController }) => {
            const msg = `Hey, your background task is finished.`;
            voiceController.tts.speak(msg);
        });
    });
  }

  // ActionCache helpers — max 200 entries, 30-minute TTL
  _ACTION_CACHE_MAX = 200;
  _ACTION_CACHE_TTL_MS = 30 * 60 * 1000;

  _setCacheEntry(key, value) {
    const now = Date.now();
    this.actionCache[key] = value;
    this._actionCacheTimestamps[key] = now;

    // Purge expired entries
    for (const k of Object.keys(this._actionCacheTimestamps)) {
      if (now - this._actionCacheTimestamps[k] > this._ACTION_CACHE_TTL_MS) {
        delete this.actionCache[k];
        delete this._actionCacheTimestamps[k];
      }
    }

    // Enforce size cap — evict oldest first
    const keys = Object.keys(this._actionCacheTimestamps);
    if (keys.length > this._ACTION_CACHE_MAX) {
      const oldest = keys.sort((a, b) => this._actionCacheTimestamps[a] - this._actionCacheTimestamps[b]);
      const toEvict = oldest.slice(0, keys.length - this._ACTION_CACHE_MAX);
      for (const k of toEvict) {
        delete this.actionCache[k];
        delete this._actionCacheTimestamps[k];
      }
    }
  }

  _getCacheEntry(key) {
    const ts = this._actionCacheTimestamps[key];
    if (!ts) return undefined;
    if (Date.now() - ts > this._ACTION_CACHE_TTL_MS) {
      delete this.actionCache[key];
      delete this._actionCacheTimestamps[key];
      return undefined;
    }
    return this.actionCache[key];
  }


  async run(rawInput, options = {}) {
    let isFollowUp = false;
    if (voiceController.isFollowUpWindowActive && !options.isBackground) {
         if (DEBUG_MODE) console.log(`[AgentLoop] 🎤 Processing as Follow-Up context turn.`);
         isFollowUp = true;
         voiceController.isFollowUpWindowActive = false; // consume window
         clearTimeout(voiceController.followUpTimer);
    }
    
    this.isBusy = true;
    options.isFollowUp = isFollowUp;
    options.lastContextWindow = this.lastContextWindow;
    
    try {
        const result = await this._runInner(rawInput, options);
        
        // Start follow-up window for 3 seconds upon successful human-initiated completion
        if (!options.isBackground) {
            this.lastContextWindow = await getActiveWindow().then(w => w?.title);
            voiceController.startFollowUpWindow(3000);
        }
        process.emit('aura_telemetry', { status: 'idle' });
        return result;
    } finally {
        this.isBusy = false;
        setTimeout(() => this._processBackgroundQueue(), 100);
    }
  }

  async handleProactiveTrigger(payload) {
    if (this.isBusy) {
        if (DEBUG_MODE) console.log(`[AgentLoop] User is active. Queuing background task: ${payload.trigger}`);
        this.backgroundQueue.push(payload);
        return;
    }
    
    // If we're free, immediately process the background task
    this.backgroundQueue.push(payload);
    this._processBackgroundQueue();
  }

  async _processBackgroundQueue() {
      if (this.backgroundQueue.length === 0) return;
      const payload = this.backgroundQueue.shift();

      if (DEBUG_MODE) console.log(`[AgentLoop] 👻 Offloading Proactive Task to Sub-Agent:`, payload.trigger);

      // Fire and forget (non-blocking). Delegation Manager handles concurrency and thread-limits.
      delegationManager.dispatchToWorker(payload)
          .then(res => {
              if (DEBUG_MODE) console.log(`[AgentLoop] Sub-Agent completed background task:`, res);
          })
          .catch(err => {
              console.error(`[AgentLoop] Sub-Agent failed background task:`, err.message);
          });

      // Use setImmediate to prevent stack overflow on large queues.
      // The direct recursive call could exhaust the call stack if the queue has many items.
      if (this.backgroundQueue.length > 0) {
        setImmediate(() => this._processBackgroundQueue());
      }
  }

  async _runInner(rawInput, options = {}) {
    const signal = options.signal;
    if (DEBUG_MODE) console.log(`\n--- [AgentLoop] Starting State Machine for: "${rawInput}" ---`);
    
    // ⚡ 1. FAST PATH
    const fastAction = this._fastIntentHandler(rawInput);
    if (fastAction) {
      if (DEBUG_MODE) console.log(`[AgentLoop] ⚡ Fast Path Hit:`, fastAction);
      
      if (fastAction.delegateTask) {
         this.handleProactiveTrigger({ trigger: 'code_generation', prompt: rawInput });
         return formatResponse(`I'm assigning a background worker to code that for you right now. You can keep talking to me while it finishes.`);
      }

      if (fastAction.moveCommand) {
        eventBus.emit('MOVE_AGENT', fastAction.moveCommand);
        return formatResponse(`Rocky moved ${fastAction.moveCommand}.`);
      }
      if (fastAction.moveNearActiveClose) {
        const active = await getActiveWindow();
        if (active?.bounds) {
          this._moveNearPoint(
            active.bounds.x + active.bounds.width - 16,
            active.bounds.y + 16,
            'close_button'
          );
          await new Promise(resolve => setTimeout(resolve, 450));
        }
      }
      await this.toolManager.execute(fastAction.tool, fastAction.args);
      return formatResponse(`Rocky executed ${fastAction.tool}. Amaze.`);
    }

    // ⚡ 9. PARALLEL INIT (Retrieve Context + Get Window)
    const [activeWindow, ragContext, graphContext] = await Promise.all([
      getActiveWindow(),
      this.userMemory.retrieveRelevantContext(rawInput),
      graphManager.getEntityContext(rawInput)
    ]);

    // Passive Fact Extraction (Non-blocking)
    extractFacts(rawInput, this.aiProvider).then((res) => {
      if (res && res.facts && res.facts.length > 0) {
        res.facts.forEach(f => {
          graphManager.upsertFact({ ...f, source: 'passive_extraction' }).catch(() => {});
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

    // C4: If rawInput is already a valid JSON intent from SemanticInterpreter, pre-parse it
    // This skips the redundant IntentParser LLM call for semantic-routed commands
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

    // Global kill switch listener
    const abortListener = () => {
       if (signal && signal.abort) signal.abort(); // Internal abort
       ctx.state = STATE.COMPLETE;
       ctx.directResponse = "Execution was physically interrupted.";
    };
    eventBus.on('execution:abort', abortListener);

    while (ctx.state !== STATE.COMPLETE && ctx.stepCount < this.MAX_STEPS) {
      if (signal?.aborted || ctx.state === STATE.COMPLETE) {
        if (DEBUG_MODE) console.log(`[AgentLoop] 🛑 Execution Aborted.`);
        eventBus.off('execution:abort', abortListener);
        return formatResponse(ctx.directResponse || "Stopped. What's next?");
      }

      ctx.stepCount++;
      // Only refresh active window if executing
      if (ctx.state !== STATE.PLAN) {
        ctx.activeWindow = await getActiveWindow();
      }

      switch (ctx.state) {
        case STATE.PLAN:
          await this._handlePlanState(ctx, signal);
          break;
        case STATE.EXECUTE:
          await this._handleExecuteState(ctx, signal);
          break;
        case STATE.VALIDATE:
          await this._handleValidateState(ctx, signal);
          break;
        case STATE.RECOVER:
          await this._handleRecoverState(ctx, signal);
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

    if (lower.includes('write a ') && (lower.includes('script') || lower.includes('program') || lower.includes('code'))) {
        return { delegateTask: true };
    }

    // Parse goal from JSON rawInput if present
    let goal;
    try { goal = JSON.parse(input)?.goal || ''; } catch { goal = lower; }

    if (lower.includes('volume up') || goal === 'volume_up')    return { tool: 'systemControl', args: { action: 'volume up' } };
    if (lower.includes('volume down') || goal === 'volume_down') return { tool: 'systemControl', args: { action: 'volume down' } };
    if (lower.includes('mute') || goal === 'mute')              return { tool: 'systemControl', args: { action: 'mute' } };
    if (lower.includes('screenshot') || goal === 'take_screenshot') return { tool: 'takeScreenshot', args: {} };
    if (/\b(close|exit)\s+(this\s+)?(window|app)\b/.test(lower) || goal === 'close_app') {
      return { tool: 'pressKey', args: { key: '%{F4}' }, moveNearActiveClose: true };
    }

    const moveMatch = lower.match(/\bmove\s+(?:to\s+)?(top left|top right|bottom left|bottom right|center)\b/);
    if (moveMatch) return { moveCommand: moveMatch[1] };

    const mediaCommands = ['play', 'pause', 'next', 'previous', 'skip', 'resume'];
    const isDirectMediaGoal = ['pause_music', 'resume_music', 'next_track', 'previous_track', 'play_pause'].includes(goal);
    if (mediaCommands.includes(lower) || lower === 'play music' || lower === 'pause music' || isDirectMediaGoal) {
       const key = (lower.includes('next') || goal === 'next_track') ? '{MEDIA_NEXT}'
         : (lower.includes('prev') || goal === 'previous_track') ? '{MEDIA_PREV}'
         : '{MEDIA_PLAY_PAUSE}';
       return { tool: 'pressKey', args: { key } };
    }

    return null;
  }

  _moveNearPoint(x, y, label = 'target') {
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return;
    eventBus.emit('MOVE_AGENT', {
      x: Math.round(Number(x)),
      y: Math.round(Number(y)),
      anchor: 'near',
      label
    });
  }

  // ——— UIMapCoordinator delegate wrappers ———————————————————————————

  async _buildWindowSnapshot(activeWindow = null) {
    return this.uiMapCoordinator.buildWindowSnapshot(activeWindow);
  }

  _windowMatchesExpected(windowInfo, expected) {
    return this.uiMapCoordinator.windowMatchesExpected(windowInfo, expected);
  }

  async _attachValidatedUIMap(ctx, activeWindow = ctx.activeWindow) {
    return this.uiMapCoordinator.attachValidatedUIMap(ctx, activeWindow);
  }

  async _refreshUIMap(ctx, options = {}) {
    return this.uiMapCoordinator.refreshUIMap(ctx, this.aiProvider, options);
  }

  _planUsesRawCoordinates(plan) {
    return Array.isArray(plan) && plan.some((step) => (
      step.tool === 'mouseClick' &&
      Number.isFinite(Number(step.input?.x)) &&
      Number.isFinite(Number(step.input?.y))
    ));
  }

  _shouldLoadActiveUIMap(ctx) {
    return this.uiMapCoordinator.shouldLoadActiveUIMap(ctx);
  }

  _shouldDeferUIDiscovery(ctx, currentStep) {
    return this.uiMapCoordinator.shouldDeferUIDiscovery(ctx, currentStep);
  }

  async _maybeResolveUIMapAfterStep(ctx, currentStep, result) {
    return this.uiMapCoordinator.maybeResolveUIMapAfterStep(ctx, currentStep, result, this.aiProvider);
  }

  // ——— ClickResolver delegate wrappers —————————————————————————

  _extractClickTarget(args, ctx) {
    return this.clickResolver.extractClickTarget(args, ctx);
  }

  _extractLocatedPoint(toolResult) {
    return this.clickResolver.extractLocatedPoint(toolResult);
  }

  _pointMatchesUIMap(map, x, y, target = null) {
    return this.clickResolver.pointMatchesUIMap(map, x, y, target);
  }

  async _resolveMouseClickArgs(ctx, args) {
    return this.clickResolver.resolveMouseClickArgs(ctx, args, this.aiProvider);
  }

  // ——— planUtils delegate wrappers ————————————————————————————

  _asEntityValue(value) { return Array.isArray(value) ? value[0] : value; }
  _inferAppName(ctx) { return inferAppName(ctx); }
  _extractTextToType(rawInput) { return extractTextToType(rawInput); }
  _extractSearchText(ctx) { return extractSearchText(ctx); }
  _extractMathExpression(ctx) { return extractMathExpression(ctx); }

  _sanitizePlan(ctx, steps = []) {
    const app = this._inferAppName(ctx);
    let lastResource = app;

    return steps
      .filter(step => step && step.tool)
      .map((step) => {
        const next = {
          ...step,
          input: { ...(step.input || {}) }
        };

        if (next.tool === 'open_resource') {
          const query = String(next.input.query || '').trim();
          if (!query || /^<.+>$/.test(query)) next.input.query = app;
          lastResource = next.input.query || lastResource;
        }

        if ((next.tool === 'waitForAppReady' || next.tool === 'focusWindow') && !next.input.appName) {
          next.input.appName = lastResource || app;
        }

        if (next.tool === 'typeText' && !next.input.text) {
          next.input.text = this._extractTextToType(ctx.rawInput) || this._extractSearchText(ctx) || '';
        }

        if (next.tool === 'calculate' && !next.input.expression) {
          next.input.expression = this._extractMathExpression(ctx);
        }

        return next;
      })
      .filter(step => {
        if (step.tool === 'open_resource') return Boolean(step.input.query);
        if (step.tool === 'waitForAppReady' || step.tool === 'focusWindow') return Boolean(step.input.appName);
        if (step.tool === 'typeText') return Boolean(step.input.text);
        if (step.tool === 'calculate') return Boolean(step.input.expression);
        return true;
      });
  }

  async _handlePlanState(ctx, signal) {
    if (signal?.aborted) return;
    if (DEBUG_MODE) console.log(`[AgentLoop] State: PLAN`);
    
    // Format RAG context for prompts
    let ragString = "";
    if (ctx.ragContext.facts.length > 0 || ctx.ragContext.workflows.length > 0) {
      ragString = "\n\nRelevant user knowledge:\n";
      if (ctx.ragContext.facts.length > 0) ragString += `Facts:\n- ${ctx.ragContext.facts.join('\n- ')}\n`;
      if (ctx.ragContext.workflows.length > 0) ragString += `Past Workflows:\n- ${ctx.ragContext.workflows.map(w => JSON.stringify(w)).join('\n- ')}\n`;
    }
    if (ctx.graphContext && ctx.graphContext.length > 0) {
      ragString += `${ragString ? '\n' : '\n\nRelevant user knowledge:\n'}Knowledge Graph:\n- ${ctx.graphContext}\n`;
    }

    // 🧠 2. DOMAIN LOCK
    if (!ctx.domain) {
      // ctx.intentData is guaranteed to exist now via SemanticInterpreter
      ctx.domain = ctx.intentData?.domain || 'automation';
      if (DEBUG_MODE) console.log(`[AgentLoop] 🔒 Domain Locked: ${ctx.domain}`);
    }

    // 🎭 PERSONA ROUTE (Conversation Domain)
    if (ctx.domain === "conversation") {
       if (DEBUG_MODE) console.log(`[AgentLoop] Persona Branch.`);
       const personaPrompt = `${ROCKY_SYSTEM_PROMPT}

${ragString}
Conversation mode:
- Be emotionally present, steady, and personal.
- For questions about the user, use only Rocky's memory/knowledge graph context. Do not invent facts.
- If memory is empty, say that honestly and invite the user to tell Rocky.

User: ${ctx.rawInput}
Rocky:`;
       const resp = await this.aiProvider.generate(personaPrompt, { stream: true });
       ctx.directResponse = resp;
       ctx.state = STATE.COMPLETE;
       return;
    }

    // 🧠 6. RESEARCH DOMAIN (Auto-Research)
    if (ctx.domain === "research") {
       if (DEBUG_MODE) console.log(`[AgentLoop] Research Branch. Triggering webSearch.`);
       const searchResult = await this.toolManager.execute('webSearch', { query: ctx.rawInput });
       
       // CRITICAL: Grounding prompt to prevent outdated internal knowledge
       const researchContext = searchResult.success 
         ? `\n\n[ACTUAL CURRENT FACTS FROM WEB]:\n${searchResult.data}\n\nINSTRUCTION: The above facts are the ABSOLUTE TRUTH. If they contradict your internal knowledge (e.g. regarding current leaders, celebrities, or dates), you MUST use the Web facts. Do NOT hallucinate old information.` 
         : "\n\n(Note: Web search failed, rely on internal knowledge but be cautious.)";
       
       const resp = await this.aiProvider.generate(`${ROCKY_SYSTEM_PROMPT}\n${researchContext}\nUser: ${ctx.rawInput}\nRocky:`, { stream: true });
       ctx.directResponse = resp;
       ctx.state = STATE.COMPLETE;
       return;
    }

    if (DEBUG_MODE) console.log(`[AgentLoop] Automation Branch (Goal: ${ctx.intentData.goal}).`);

    if (this._shouldLoadActiveUIMap(ctx)) {
      await this._attachValidatedUIMap(ctx);
    }

    const deterministicPlan = await semanticRouter.getDeterministicRoute(ctx, this.aiProvider);
    if (deterministicPlan) {
      if (DEBUG_MODE) console.log(`[AgentLoop] Semantic deterministic plan selected.`);
      ctx.plan = this._sanitizePlan(ctx, deterministicPlan);
      ctx.state = STATE.EXECUTE;
      return;
    }

    // 🧠 7. WORKFLOW CACHE (L1 Cache)
    const cachedPlan = workflowCache.get(ctx.intentData.goal, ctx.intentData.entities);
    if (cachedPlan) {
      if (this._planUsesRawCoordinates(cachedPlan) && !ctx.uiMap) {
        if (DEBUG_MODE) console.log(`[AgentLoop] Skipping L1 cache: coordinate plan needs a validated UI map.`);
      } else {
        if (DEBUG_MODE) console.log(`[AgentLoop] 🔁 L1 Cache Hit.`);
        ctx.plan = this._sanitizePlan(ctx, cachedPlan);
        ctx.state = STATE.EXECUTE;
        return;
      }
    }

    // 🧠 4. WORKFLOW PLANNER (L2/Heavy Path)
    let planResponse;
    const basePrompt = ctx.options?.isFollowUp && ctx.options?.lastContextWindow
        ? `[FOLLOW-UP: User is continuing task on '${ctx.options.lastContextWindow}']. ${ctx.rawInput}`
        : ctx.rawInput;
    const strictContext = await buildPlannerContext(basePrompt, ctx.sessionId, this.aiProvider);
    try {
      process.emit('aura_telemetry', { status: 'thinking', source: 'L2_Planner' });
      planResponse = await withGuard(
        this.planner.createPlan(ctx.intentData.goal, ctx.intentData.entities, [], 1, strictContext, ctx.uiMap || {}),
        ctx.signal,
        'planner'
      );
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      planResponse = { steps: [] };
    }
    
    ctx.plan = this._sanitizePlan(ctx, planResponse.steps || []);

    if (!ctx.plan || ctx.plan.length === 0) {
      if (DEBUG_MODE) console.log(`[AgentLoop] Invalid or empty plan generated.`);
      ctx.directResponse = "Grace, I couldn't figure out the steps to do that. Can you rephrase?";
      ctx.state = STATE.COMPLETE;
    } else {
      ctx.state = STATE.EXECUTE;
    }
  }

  async _handleExecuteState(ctx, signal) {
    if (signal?.aborted) return;
    if (DEBUG_MODE) console.log(`[AgentLoop] State: EXECUTE (Step ${ctx.currentStepIndex + 1}/${ctx.plan.length})`);
    const currentStep = ctx.plan[ctx.currentStepIndex];
    
    // 🧠 4. TOOL VALIDATION (Whitelisting)
    if (!ctx.domain || !DOMAIN_TOOLS[ctx.domain]) {
      ctx.domain = 'conversation'; 
    }

    if (!DOMAIN_TOOLS[ctx.domain].includes(currentStep.tool)) {
      const error = `SECURITY: Tool "${currentStep.tool}" is forbidden in ${ctx.domain} domain.`;
      console.error(`[AgentLoop] ${error}`);
      ctx.history.push({ action: 'fail', error });
      ctx.state = STATE.RECOVER;
      return;
    }

    if (!this.toolManager.has(currentStep.tool)) {
      ctx.history.push({ action: 'fail', error: `Invalid tool hallucinated: ${currentStep.tool}` });
      ctx.state = STATE.RECOVER;
      return;
    }

    let currentArgs = currentStep.input || {};

    // Variable injection ($LAST_OUTPUT)
    const lastResult = ctx.history.length > 0 ? ctx.history[ctx.history.length - 1].result : null;
    if (lastResult && currentArgs) {
      currentArgs = JSON.parse(JSON.stringify(currentArgs));
      const resolveLastOutputPath = (pathText = '') => {
        const path = pathText ? pathText.split('.') : [];
        let resolved = lastResult.data ?? lastResult;
        for (const part of path) {
          resolved = resolved && typeof resolved === 'object' ? resolved[part] : undefined;
        }
        return resolved;
      };

      for (let key in currentArgs) {
        let val = currentArgs[key];
        if (typeof val !== 'string') continue;
        if (val === '$LAST_OUTPUT') {
          currentArgs[key] = lastResult.data ?? lastResult;
          continue;
        }
        const exactVariable = val.match(/^\$LAST_OUTPUT(?:\.([\w.]+))?$/);
        if (exactVariable) {
          const resolved = resolveLastOutputPath(exactVariable[1] || '');
          if (resolved !== undefined) currentArgs[key] = resolved;
          continue;
        }
        const variableRegex = /\$LAST_OUTPUT(\.[\w.]+)?/g;
        currentArgs[key] = val.replace(variableRegex, (match) => {
          if (match === '$LAST_OUTPUT') return JSON.stringify(lastResult.data ?? lastResult);
          const resolved = resolveLastOutputPath(match.replace('$LAST_OUTPUT.', ''));
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

    if (currentStep.tool === 'analyze_ui' && !currentArgs.currentWindow) {
      currentArgs.currentWindow = ctx.activeWindow;
    }

    if (currentStep.tool === 'mouseClick') {
      currentArgs = await this._resolveMouseClickArgs(ctx, currentArgs);
      if (DEBUG_MODE) console.log(`[AgentLoop] Resolved mouseClick args:`, currentArgs);
      this._moveNearPoint(currentArgs.x, currentArgs.y, currentArgs._uiMapLabel || currentArgs.label || 'click_target');
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    // Performance Optimization: Check Cache
    const cacheKey = `${ctx.activeWindow?.appName}_${currentStep.tool}_${JSON.stringify(currentArgs)}`;
    const canUseActionCache = currentStep.tool !== 'mouseClick';
    if (canUseActionCache && this.actionCache && this.actionCache[cacheKey]) {
      if (DEBUG_MODE) console.log(`[AgentLoop] Using cached execution for ${currentStep.tool}`);
      currentArgs = this.actionCache[cacheKey]; // Inject known working coords/args
    }

    // TRUE VALIDATION LOOP: Only mouseClick needs visual confirmation
    // Non-hardware tools (open, wait, focus, type, key) always pass
    const PIXEL_VALIDATE_TOOLS = ['mouseClick'];
    const needsPixelValidation = PIXEL_VALIDATE_TOOLS.includes(currentStep.tool);

    let beforeImg = null;
    if (needsPixelValidation) {
      const { captureTempScreenshot } = await import('#tools/system/verifyExecution.js');
      beforeImg = await captureTempScreenshot(`before_${Date.now()}.png`);
    }

    // Inject the abort signal into the tool arguments so tools can halt midway.
    currentArgs._signal = ctx.signal;

    let result;
    try {
      process.emit('aura_telemetry', { status: 'executing', target: 'UIA_Daemon' });
      result = await withGuard(
        this.toolManager.execute(currentStep.tool, currentArgs),
        ctx.signal,
        `tool_${currentStep.tool}`
      );
    } catch (err) {
      if (err.name === 'AbortError') throw err; // Bubble up to process() loop
      result = { success: false, error: err.message };
    }

    if (result.success && ['focusWindow', 'waitForAppReady'].includes(currentStep.tool)) {
      const activeAfterTool = await getActiveWindow();
      if (!this._windowMatchesExpected(activeAfterTool, currentArgs.appName)) {
        result.success = false;
        result.error = `${currentStep.tool} did not leave ${currentArgs.appName} active.`;
      }
    }

    // For non-pixel-validated tools, trust the tool's own success flag
    if (!needsPixelValidation) {
      ctx.history.push({ tool: currentStep.tool, args: currentArgs, result });
      if (result.success) {
        await this._maybeResolveUIMapAfterStep(ctx, currentStep, result);
      }
      ctx.state = STATE.VALIDATE;
      return;
    }

    // Pixel validation for mouseClick
    const { captureTempScreenshot: cap2, compareScreenshots } = await import('#tools/system/verifyExecution.js');
    await new Promise(r => setTimeout(r, 500));
    const afterImg = await cap2(`after_${Date.now()}.png`);
    const clickX = currentArgs.x || -1;
    const clickY = currentArgs.y || -1;
    const validation = await compareScreenshots(beforeImg, afterImg, clickX, clickY);
    if (DEBUG_MODE) console.log(`[AgentLoop] Validation Check:`, validation);
    
    if (!validation.changed && currentStep.tool === 'mouseClick') {
       if (DEBUG_MODE) console.log(`[AgentLoop] True Validation Failed: UI did not change.`);
       result.success = false;
       result.error = 'UI unchanged after click.';
       if (currentArgs._uiMapId) {
         recordUIMapFailure(currentArgs._uiMapId);
         currentArgs._uiMapFailureRecorded = true;
       }
    } else if (result.success) {
       if (currentStep.tool === 'analyze_ui' && result.uiMap) {
         const uiMap = {
           ...result.uiMap,
           visualSignature: await captureUIVisualSignature(result.uiMap.elements)
         };
         const saved = saveUIMap(ctx.activeWindow?.appName, ctx.activeWindow?.windowTitle, uiMap, {
           currentWindow: ctx.activeWindow,
           executionSucceeded: true
         });
         ctx.uiMap = saved.saved ? saved.map : uiMap;
         ctx.uiMapSource = saved.saved ? 'vision' : 'vision_transient';
       } else if (currentStep.tool === 'mouseClick') {
         if (currentArgs._uiMapId) recordUIMapSuccess(currentArgs._uiMapId);
         if (currentArgs._uiMapTransient && ctx.uiMap) {
           const saved = saveUIMap(ctx.activeWindow?.appName, ctx.activeWindow?.windowTitle, ctx.uiMap, {
             currentWindow: ctx.activeWindow,
             executionSucceeded: true
           });
           if (saved.saved) {
             ctx.uiMap = saved.map;
             ctx.uiMapSource = 'vision';
           }
         }
       } else if (canUseActionCache) {
         // Cache success for non-coordinate actions only.
         this.actionCache = this.actionCache || {};
         this.actionCache[cacheKey] = currentArgs;
       }

       // 👁️ UI DISCOVERY: If we just opened a desktop app, analyze it
       await this._maybeResolveUIMapAfterStep(ctx, currentStep, result);
    } else if (currentStep.tool === 'mouseClick' && currentArgs._uiMapId) {
       recordUIMapFailure(currentArgs._uiMapId);
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
    const lastError = lastExecution.error || lastExecution.result?.error || '';
    const lastTool = lastExecution.tool || ctx.plan[ctx.currentStepIndex]?.tool;
    const lastArgs = lastExecution.args || ctx.plan[ctx.currentStepIndex]?.input || {};

    if (ctx.retryCount >= this.RETRY_LIMIT) {
      console.log(`[AgentLoop] Recovery exhausted after ${this.RETRY_LIMIT} retries.`);
      ctx.history.push({ action: 'fail', error: 'Max retries reached.' });
      ctx.directResponse = "I ran into a wall on that one. Can you tell me what you see on screen?";
      ctx.state = STATE.COMPLETE;
      return;
    }

    ctx.retryCount++;

    // ── Recovery Strategy 1: Invalid tool — re-plan with hard constraint ──
    if (lastError && lastError.includes('Invalid tool')) {
      const constraint = `Previous plan failed: invalid tool "${lastTool}". Only use tools from the provided list.`;
      ctx.history.push({ action: 'constraint', error: constraint });
      const planResponse = await this.planner.createPlan(
        ctx.intentData.goal, ctx.intentData.entities, ctx.history, 1, '', ctx.uiMap || {}
      );
      if (planResponse.steps?.length > 0) {
        ctx.plan = planResponse.steps;
        ctx.currentStepIndex = 0;
        ctx.state = STATE.EXECUTE;
        return;
      }
    }

    // ── Recovery Strategy 2: Click failure ────────────────────────────────
    if (lastTool === 'mouseClick') {
      if (lastExecution.args?._uiMapId) recordUIMapFailure(lastExecution.args._uiMapId);

      const target = this._extractClickTarget(lastArgs, ctx);
      if (!target) {
        ctx.directResponse = "I couldn't identify what to click. Can you describe it?";
        ctx.state = STATE.COMPLETE;
        return;
      }

      // Strategy 2a: Try OCR first (fast, ~200ms)
      console.log(`[AgentLoop] Recovery: trying OCR for "${target}"...`);
      try {
        const ocrResult = await this.toolManager.execute('ocrSearch', { query: target });
        const ocrPoint = ocrResult?.data || ocrResult;
        if (ocrPoint?.x > 0 && ocrPoint?.y > 0) {
          console.log(`[AgentLoop] Recovery: OCR found "${target}" at (${ocrPoint.x}, ${ocrPoint.y})`);
          ctx.plan[ctx.currentStepIndex].input = { ...lastArgs, x: ocrPoint.x, y: ocrPoint.y, _ocrLocated: true };
          ctx.state = STATE.EXECUTE;
          return;
        }
      } catch (e) {
        console.log(`[AgentLoop] Recovery: OCR failed (${e.message}), trying vision...`);
      }

      // Strategy 2b: Keyboard shortcut fallback for known targets
      const KEYBOARD_FALLBACKS = {
        'search': '^f', 'find': '^f', 'address bar': '^l', 'url': '^l',
        'new tab': '^t', 'close': '{ESC}', 'back': '%{LEFT}', 'forward': '%{RIGHT}',
      };
      const lowerTarget = String(target).toLowerCase();
      const kbFallback = Object.entries(KEYBOARD_FALLBACKS).find(([k]) => lowerTarget.includes(k));
      if (kbFallback) {
        console.log(`[AgentLoop] Recovery: keyboard fallback for "${target}" → ${kbFallback[1]}`);
        ctx.plan[ctx.currentStepIndex] = { tool: 'pressKey', input: { key: kbFallback[1] } };
        ctx.state = STATE.EXECUTE;
        return;
      }

      // Strategy 2c: LLaVA vision (last resort, slow)
      if (ctx.retryCount <= 1) {
        console.log(`[AgentLoop] Recovery: LLaVA vision fallback for "${target}"...`);
        const visionResult = await this.toolManager.execute('locateUIElement', { description: target }, this.aiProvider);
        const point = this._extractLocatedPoint(visionResult);
        if (point) {
          ctx.plan[ctx.currentStepIndex].input = { ...lastArgs, x: point.x, y: point.y, _visionLocated: true };
          ctx.state = STATE.EXECUTE;
          return;
        }
      }

      // All strategies failed
      ctx.directResponse = `I couldn't find "${target}" on screen to click it.`;
      ctx.state = STATE.COMPLETE;
      return;
    }

    // ── Recovery Strategy 3: App open/focus failure ────────────────────────
    if (['open_resource', 'focusWindow', 'waitForAppReady'].includes(lastTool)) {
      const appName = lastArgs.appName || lastArgs.query;
      if (appName) {
        // Try bringing the window forward using UIA
        const switchCmd = `powershell -NoProfile -Command "$proc = Get-Process | Where-Object { $_.MainWindowTitle -match '${appName}' } | Select-Object -First 1; if ($proc) { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) }"`;  
        await new Promise(r => exec(switchCmd, () => r()));
        await new Promise(r => setTimeout(r, 800));
        // Re-check if the window is now active
        const active = await getActiveWindow();
        if (this._windowMatchesExpected(active, appName)) {
          console.log(`[AgentLoop] Recovery: window for "${appName}" activated via AppActivate.`);
          ctx.state = STATE.EXECUTE;
          return;
        }
      }
    }

    // ── Default: just retry the same step ─────────────────────────────────
    console.log(`[AgentLoop] Recovery: retrying ${lastTool} (attempt ${ctx.retryCount})...`);
    ctx.state = STATE.EXECUTE;
  }

  async _generateFinalResponse(ctx) {
    const summary = ctx.history.map((h) => {
      if (!h.result) return `${h.tool || h.action}: Done`;
      const status = h.result.success ? 'Done' : 'Fail';
      const data = h.result.data ? ` (${typeof h.result.data === 'string' ? h.result.data : JSON.stringify(h.result.data)})` : '';
      const error = h.result.error ? ` (${h.result.error})` : '';
      return `${h.tool || h.action}: ${status}${data}${error}`;
    }).join(', ');
    const prompt = `${ROCKY_SYSTEM_PROMPT}\n\nTask: ${ctx.rawInput}\nSummary: ${summary}\n\nRespond briefly.`;
    const resp = await this.aiProvider.generate(prompt);
    return formatResponse(resp || "Rocky finished. Amaze.");
  }
}
