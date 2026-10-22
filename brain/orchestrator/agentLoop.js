import { formatResponse } from '#brain/personality/rockyPersonality.js';
import eventBus from '#services/eventBus.js';
import getActiveWindow from '../../automation/system/getActiveWindow.js';
import UserMemory from '#memory/userMemory.js';
import { graphManager } from '#memory/graphManager.js';
import { extractFacts } from '#memory/factExtractor.js';
import { delegationManager } from './delegationManager.js';
import voiceController from '#voice/voiceController.js';
import process from 'process';
import { ClickResolver } from './clickResolver.js';
import { UIMapCoordinator } from './uiMapCoordinator.js';
import { userTextOf } from './planUtils.js';

import { STATE, DEBUG_MODE } from './loop/constants.js';
import { fastIntentHandler, runFastPath } from './loop/fastPath.js';
import { createContext, applyPreparsedIntent, ensureIntent } from './loop/context.js';
import { handleExtractedFacts, rememberEpisode } from './loop/memoryHooks.js';
import { generateFinalResponse } from './loop/finalResponse.js';
import { handlePlanState } from './loop/states/plan.js';
import { handleExecuteState } from './loop/states/execute.js';
import { handleValidateState } from './loop/states/validate.js';
import { handleRecoverState } from './loop/states/recover.js';

/** Which function runs each state of the machine. */
const STATE_HANDLERS = {
  [STATE.PLAN]: handlePlanState,
  [STATE.EXECUTE]: handleExecuteState,
  [STATE.VALIDATE]: handleValidateState,
  [STATE.RECOVER]: handleRecoverState,
};

/**
 * AgentLoop - Dynamic State Machine Orchestrator
 *
 *   PLAN -> EXECUTE -> VALIDATE -> (next step | COMPLETE)
 *                         \-> RECOVER -> EXECUTE
 *
 * This class owns the lifecycle (run, the background queue, the loop itself). What each state
 * does lives in ./loop/states, and the shared pieces (fast path, context, memory hooks, plan
 * clean-up, the final reply) in ./loop.
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

    // The router's example phrases are embedded by Brain after the brain model has loaded (brain/index.js).

    eventBus.on('WORKER_TASK_COMPLETE', (payload) => {
        console.log(`[AgentLoop] Background worker finished task: ${payload.trigger || payload.prompt}`);
        import('#voice/voiceController.js').then(({ default: voiceController }) => {
            const msg = `Hey, your background task is finished.`;
            voiceController.tts.speak(msg);
        });
    });
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
    const fastAction = fastIntentHandler(rawInput);
    if (fastAction) return runFastPath(this, fastAction, rawInput);

    // ⚡ 9. PARALLEL INIT (Retrieve Context + Get Window)
    // Memory is searched and facts are extracted from what Grace SAID, not from the interpreter's JSON.
    const userText = userTextOf(rawInput);
    const [activeWindow, ragContext, graphContext] = await Promise.all([
      getActiveWindow(),
      this.userMemory.retrieveRelevantContext(userText),
      graphManager.getEntityContext(userText)
    ]);

    // Passive Fact Extraction (Non-blocking)
    extractFacts(userText, this.aiProvider).then((res) => handleExtractedFacts(res, this)).catch(() => {});

    const ctx = createContext({ rawInput, options, signal, activeWindow, ragContext, graphContext });
    applyPreparsedIntent(ctx, rawInput);
    ensureIntent(ctx, rawInput);

    return this._runStateMachine(ctx, signal);
  }

  async _runStateMachine(ctx, signal) {
    // Global kill switch listener
    const abortListener = () => {
       if (signal && signal.abort) signal.abort(); // Internal abort
       ctx.state = STATE.COMPLETE;
       ctx.directResponse = "Execution was physically interrupted.";
    };
    eventBus.on('execution:abort', abortListener);

    try {
      while (ctx.state !== STATE.COMPLETE && ctx.stepCount < this.MAX_STEPS) {
        if (signal?.aborted || ctx.state === STATE.COMPLETE) {
          if (DEBUG_MODE) console.log(`[AgentLoop] 🛑 Execution Aborted.`);
          return formatResponse(ctx.directResponse || "Stopped. What's next?");
        }

        ctx.stepCount++;
        // Only refresh active window if executing
        if (ctx.state !== STATE.PLAN) {
          ctx.activeWindow = await getActiveWindow();
        }

        await STATE_HANDLERS[ctx.state](this, ctx, signal);
      }

      if (ctx.state !== STATE.COMPLETE) {
        rememberEpisode(ctx, 'failed');
        return formatResponse("Grace... Rocky tried hard but couldn't finish the workflow.");
      }

      if (ctx.directResponse) return formatResponse(ctx.directResponse);

      return await generateFinalResponse(this, ctx);
    } finally {
      // Every run registers the listener above, so every run (finished, failed, aborted or thrown)
      // must remove it. Before this, only an aborted run did, so listeners piled up one per task.
      eventBus.off('execution:abort', abortListener);
    }
  }
}
