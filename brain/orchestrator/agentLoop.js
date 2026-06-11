import { ROCKY_SYSTEM_PROMPT, formatResponse } from '#brain/personality/rockyPersonality.js';
import eventBus from '#services/eventBus.js';
import getActiveWindow from '../../automation/system/getActiveWindow.js';
import { workflowCache } from '#memory/workflowCache.js';
import UserMemory from '#memory/userMemory.js';
import { graphManager } from '#memory/graphManager.js';
import { extractFacts } from '#memory/factExtractor.js';
import getUIElements from '#tools/system/getUIElements.js';
import { exec } from 'child_process';
import { semanticRouter } from './semanticRouter.js';
import { buildPlannerContext } from '#memory/contextManager.js';
import { supervisor } from './supervisor.js';
import { delegationManager } from './delegationManager.js';
import voiceController from '#voice/voiceController.js';
import { withGuard } from '../runtime/executionGuard.js';
import process from 'process';
import {
  findElementInMap,
  getUIMapCandidates,
  recordUIMapFailure,
  recordUIMapSuccess,
  saveUIMap,
  validateUIMap
} from '#memory/uiMapStore.js';
import { captureUIVisualSignature } from '#tools/system/uiVisualSignature.js';



const STATE = {
  PLAN: 'PLAN',
  EXECUTE: 'EXECUTE',
  VALIDATE: 'VALIDATE',
  RECOVER: 'RECOVER',
  COMPLETE: 'COMPLETE'
};

const DEBUG_MODE = true;

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

    // H3: VisionHandler and CorrectionHandler removed — never called in runtime
    this.userMemory = new UserMemory(aiProvider);
    // KnowledgeGraph removed, using graphManager singleton

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
      
      // Recursively process the rest of the queue instantly
      this._processBackgroundQueue();
  }

  async _runInner(rawInput, options = {}) {
    const signal = options.signal;
    if (DEBUG_MODE) console.log(`\n--- [AgentLoop] Starting State Machine for: "${rawInput}" ---`);
    
    // ⚡ 1. FAST PATH
    const fastAction = this._fastIntentHandler(rawInput);
    if (fastAction) {
      if (DEBUG_MODE) console.log(`[AgentLoop] ⚡ Fast Path Hit:`, fastAction);
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

      // Check Supervisor pause state
      if (supervisor.isPaused) {
         await supervisor.waitUntilResumed();
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

  _windowMatchesExpected(windowInfo, expected) {
    if (!expected || !windowInfo) return true;
    const needle = String(expected).toLowerCase();
    const app = String(windowInfo.appName || '').toLowerCase();
    const title = String(windowInfo.windowTitle || '').toLowerCase();
    return app.includes(needle) || needle.includes(app) || title.includes(needle);
  }

  async _buildWindowSnapshot(activeWindow = null) {
    const windowInfo = activeWindow || await getActiveWindow();
    if (!windowInfo || windowInfo.isMinimized) return windowInfo;

    const uiResult = await getUIElements({ foregroundOnly: true, maxElements: 200 });
    return {
      ...windowInfo,
      uiElements: uiResult.success ? uiResult.elements : []
    };
  }

  async _attachValidatedUIMap(ctx, activeWindow = ctx.activeWindow) {
    const snapshot = await this._buildWindowSnapshot(activeWindow);
    ctx.activeWindow = snapshot;

    const candidates = getUIMapCandidates(snapshot?.appName, snapshot?.windowTitle);
    for (const candidate of candidates) {
      const liveSignature = candidate.visualSignature
        ? await captureUIVisualSignature(candidate.elements)
        : null;
      const validation = validateUIMap({
        ...snapshot,
        visualSignature: liveSignature
      }, candidate);

      if (!validation.valid) {
        if (DEBUG_MODE) {
          console.log(`[AgentLoop] UI map rejected: ${validation.reasons.join(', ')}.`);
        }
        continue;
      }

      const validMap = { ...candidate, validation };
      ctx.uiMap = validMap;
      ctx.uiMapSource = 'cache';
      ctx.uiMapChecked = true;

      if (DEBUG_MODE) {
        console.log(`[AgentLoop] UI map cache hit for ${validMap.app} (${validMap.elements.length} elements).`);
      }

      return validMap;
    }

    return null;
  }

  async _refreshUIMap(ctx, options = {}) {
    const { force = false, persist = true, executionSucceeded = true } = options;
    const snapshot = await this._buildWindowSnapshot(await getActiveWindow());
    ctx.activeWindow = snapshot;

    if (!force) {
      const validMap = await this._attachValidatedUIMap(ctx, snapshot);
      if (validMap) {
        return validMap;
      }
    }

    if (DEBUG_MODE) console.log(`[AgentLoop] Running live UI analysis for ${snapshot?.appName || 'unknown'}...`);
    const analysis = await this.toolManager.execute('analyze_ui', { currentWindow: snapshot }, this.aiProvider);
    ctx.uiMapChecked = true;

    if (!analysis.success || !analysis.uiMap) {
      if (DEBUG_MODE) console.log(`[AgentLoop] UI analysis failed: ${analysis.error || 'unknown error'}`);
      return null;
    }

    const visualSignature = await captureUIVisualSignature(analysis.uiMap.elements);
    const uiMap = {
      ...analysis.uiMap,
      visualSignature
    };

    if (persist) {
      const saved = saveUIMap(snapshot.appName, snapshot.windowTitle, uiMap, {
        currentWindow: snapshot,
        executionSucceeded
      });

      if (saved.saved) {
        ctx.uiMap = saved.map;
        ctx.uiMapSource = 'vision';
        return saved.map;
      }

      if (DEBUG_MODE) console.log(`[AgentLoop] UI map not persisted: ${saved.reason}`);
    }

    ctx.uiMap = uiMap;
    ctx.uiMapSource = 'vision_transient';
    return uiMap;
  }

  _planUsesRawCoordinates(plan) {
    return Array.isArray(plan) && plan.some((step) => (
      step.tool === 'mouseClick' &&
      Number.isFinite(Number(step.input?.x)) &&
      Number.isFinite(Number(step.input?.y))
    ));
  }

  _shouldLoadActiveUIMap(ctx) {
    const input = String(ctx.rawInput || '').toLowerCase();
    const appName = String(ctx.activeWindow?.appName || '').toLowerCase();
    const title = String(ctx.activeWindow?.windowTitle || '').toLowerCase();

    const activeMentioned = (
      appName && appName !== 'unknown' && input.includes(appName)
    ) || (
      title && title !== 'unknown' && title.length > 4 && input.includes(title)
    );

    if (activeMentioned) return true;

    const appSpecificButNotActive = /\b(open|launch|start)\b/.test(input) ||
      /\b(on|in|inside|with)\s+[a-z0-9][a-z0-9 _-]{2,}/.test(input);

    return !appSpecificButNotActive;
  }

  _shouldDeferUIDiscovery(ctx, currentStep) {
    const remainingTools = ctx.plan
      .slice(ctx.currentStepIndex + 1)
      .map((step) => step.tool);

    // Always defer if keyboard-only steps remain — no coordinates needed
    const keyboardOnlyRemaining = remainingTools.every(t =>
      ['pressKey', 'typeText', 'focusWindow', 'waitForAppReady'].includes(t)
    );
    if (keyboardOnlyRemaining) return true;

    if (currentStep.tool === 'open_resource') {
      return remainingTools.includes('waitForAppReady') || remainingTools.includes('focusWindow');
    }

    if (currentStep.tool === 'waitForAppReady') {
      return remainingTools.includes('focusWindow');
    }

    return false;
  }

  async _maybeResolveUIMapAfterStep(ctx, currentStep, result) {
    if (!result?.success) return;
    if (!['open_resource', 'waitForAppReady', 'focusWindow'].includes(currentStep.tool)) return;
    if (ctx.uiMap && ctx.uiMapSource === 'cache') return;
    if (this._shouldDeferUIDiscovery(ctx, currentStep)) return;

    const active = await getActiveWindow();
    const expectedApp = currentStep.input?.appName || currentStep.input?.query;
    if (expectedApp && !this._windowMatchesExpected(active, expectedApp)) {
      if (DEBUG_MODE) console.log(`[AgentLoop] Skipping UI map analysis: active window is not ${expectedApp}.`);
      return;
    }

    const validMap = await this._attachValidatedUIMap(ctx, active);
    if (validMap) return;

    await this._refreshUIMap(ctx, {
      force: true,
      persist: true,
      executionSucceeded: result.success
    });
  }

  _extractClickTarget(args, ctx) {
    const isGoalName = (s) => typeof s === 'string' && /^[a-z][a-z0-9_]+$/.test(s) && s.includes('_');

    const candidate = args.label ||
      args.description ||
      args.query ||
      args.target ||
      args.element;

    // Reject goal-name strings (e.g. 'open_and_play_song') — these are intent goals not UI labels
    if (candidate && !isGoalName(candidate)) return candidate;

    // Fall back to a meaningful description from the plan step text
    const goal = ctx.intentData?.goal;
    if (goal && !isGoalName(goal)) return goal;

    // Last resort: extract a usable noun from the raw user input
    const raw = String(ctx.rawInput || '');
    const quoted = raw.match(/["'‘’“”](.+?)["'‘’“”]/);
    if (quoted) return quoted[1];

    const noun = raw.toLowerCase().replace('rocky', '').trim();
    return noun.length > 2 ? noun : null;
  }

  _extractLocatedPoint(toolResult) {
    const point = toolResult?.data || toolResult;
    if (!toolResult?.success && !point?.x) return null;
    if (point?.error) return null;

    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
    return { ...point, x, y };
  }

  _pointMatchesUIMap(map, x, y, target = null) {
    if (!map || !Array.isArray(map.elements)) return false;
    const elements = target
      ? [findElementInMap(map, target)].filter(Boolean)
      : map.elements;

    return elements.some((element) => {
      const radiusX = Math.max(24, (element.width || 0) / 2 + 12);
      const radiusY = Math.max(24, (element.height || 0) / 2 + 12);
      return Math.abs(Number(x) - element.x) <= radiusX &&
        Math.abs(Number(y) - element.y) <= radiusY;
    });
  }

  async _resolveMouseClickArgs(ctx, args) {
    const resolved = { ...args };
    const target = this._extractClickTarget(resolved, ctx);
    const lastTool = ctx.history[ctx.history.length - 1]?.tool;
    const hasNumericPoint = Number.isFinite(Number(resolved.x)) && Number.isFinite(Number(resolved.y));

    if (!ctx.uiMap) {
      await this._attachValidatedUIMap(ctx, await getActiveWindow());
    } else if (ctx.uiMapSource === 'cache') {
      const snapshot = await this._buildWindowSnapshot(await getActiveWindow());
      const validation = validateUIMap(snapshot, ctx.uiMap);
      ctx.activeWindow = snapshot;

      if (!validation.valid) {
        if (DEBUG_MODE) console.log(`[AgentLoop] Cached UI map rejected before click: ${validation.reasons.join(', ')}`);
        recordUIMapFailure(ctx.uiMap);
        ctx.uiMap = null;
        ctx.uiMapSource = null;
      }
    }

    if (target && ctx.uiMap) {
      const cachedElement = findElementInMap(ctx.uiMap, target);
      if (cachedElement) {
        return {
          ...resolved,
          x: cachedElement.x,
          y: cachedElement.y,
          _uiMapId: ctx.uiMap.id,
          _uiMapLabel: cachedElement.label,
          _uiMapTransient: !ctx.uiMap.id
        };
      }
    }

    if (
      hasNumericPoint &&
      ctx.uiMap &&
      this._pointMatchesUIMap(ctx.uiMap, Number(resolved.x), Number(resolved.y), target)
    ) {
      return {
        ...resolved,
        x: Number(resolved.x),
        y: Number(resolved.y),
        _uiMapId: ctx.uiMap.id,
        _uiMapTransient: !ctx.uiMap.id
      };
    }

    if (hasNumericPoint && lastTool === 'locateUIElement') {
      return {
        ...resolved,
        x: Number(resolved.x),
        y: Number(resolved.y),
        _visionLocated: true
      };
    }

    const refreshedMap = await this._refreshUIMap(ctx, { force: true, persist: false });
    const refreshedElement = target && refreshedMap ? findElementInMap(refreshedMap, target) : null;
    if (refreshedElement) {
      return {
        ...resolved,
        x: refreshedElement.x,
        y: refreshedElement.y,
        _uiMapLabel: refreshedElement.label,
        _uiMapTransient: true
      };
    }

    const visionResult = await this.toolManager.execute('locateUIElement', { description: target }, this.aiProvider);
    const point = this._extractLocatedPoint(visionResult);
    if (point) {
      return {
        ...resolved,
        x: point.x,
        y: point.y,
        _visionLocated: true
      };
    }

    return resolved;
  }

  _asEntityValue(value) {
    if (Array.isArray(value)) return value[0];
    return value;
  }

  _inferAppName(ctx) {
    const entities = ctx.intentData?.entities || {};
    const direct = this._asEntityValue(
      entities.app ||
      entities.application ||
      entities.appName ||
      entities.software ||
      entities.program
    );

    if (direct) return String(direct).toLowerCase();

    const lower = String(ctx.rawInput || '').toLowerCase();
    const knownApps = ['spotify', 'notepad', 'calculator', 'chrome', 'edge', 'slack', 'whatsapp', 'vscode'];
    return knownApps.find((app) => lower.includes(app)) || null;
  }

  _extractTextToType(rawInput) {
    const text = String(rawInput || '');
    const quoted = text.match(/["'“”](.+?)["'“”]/);
    if (quoted) return quoted[1];

    const writeMatch = text.match(/\b(?:write|type)\s+(.+)$/i);
    if (writeMatch) return writeMatch[1].trim();

    if (/drink water/i.test(text)) return 'Reminder: drink water.';
    return null;
  }

  _extractSearchText(ctx) {
    const entities = ctx.intentData?.entities || {};
    const direct = this._asEntityValue(
      entities.song ||
      entities.artist ||
      entities.query ||
      entities.search ||
      entities.object_of_interest
    );
    if (direct) return String(direct);

    const raw = String(ctx.rawInput || '');
    const searchMatch = raw.match(/\bsearch\s+(?:for\s+)?(.+?)(?:,?\s+and\s+play|,?\s+and\s+open|$)/i);
    if (searchMatch) return searchMatch[1].trim();

    const playMatch = raw.match(/\bplay\s+(.+?)(?:\s+on\s+\w+|$)/i);
    if (playMatch) return playMatch[1].trim();

    return null;
  }

  _extractMathExpression(ctx) {
    const entities = ctx.intentData?.entities || {};
    if (entities.expression) return String(entities.expression);
    if (entities.number1 !== undefined && entities.number2 !== undefined) {
      const operator = entities.operator ||
        (entities.operation === 'multiply' ? '*' : null) ||
        (entities.operation === 'divide' ? '/' : null) ||
        (entities.operation === 'add' ? '+' : null) ||
        (entities.operation === 'subtract' ? '-' : null);
      if (operator) return `${entities.number1} ${operator} ${entities.number2}`;
    }

    return String(ctx.rawInput || '')
      .toLowerCase()
      .replace(/times|multiplied by/g, '*')
      .replace(/plus/g, '+')
      .replace(/minus/g, '-')
      .replace(/divided by|over/g, '/')
      .replace(/[^0-9+\-\\/().%\\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

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
