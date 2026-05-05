import { ROCKY_SYSTEM_PROMPT, formatResponse } from '../personality/rockyPersonality.js';
import eventBus from '../../controller/eventBus.js';
import getActiveWindow from '../../executor/system/getActiveWindow.js';
import VisionHandler from '../vision/visionHandler.js';
import CorrectionHandler from '../learning/correctionHandler.js';
import { workflowCache } from '../../memory/workflowCache.js';
import UserMemory from '../../memory/userMemory.js';
import KnowledgeGraph from '../../memory/knowledgeGraph.js';
import { extractFacts } from '../../memory/factExtractor.js';
import getUIElements from '../../tools/system/getUIElements.js';
import {
  findElementInMap,
  getUIMapCandidates,
  recordUIMapFailure,
  recordUIMapSuccess,
  saveUIMap,
  validateUIMap
} from '../../memory/uiMapStore.js';
import { captureUIVisualSignature } from '../../tools/system/uiVisualSignature.js';

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
    "focusWindow"
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
  constructor(intentParser, planner, toolManager, aiProvider, appActionMapper) {
    this.intentParser = intentParser;
    this.planner = planner; // This is now WorkflowPlanner
    this.toolManager = toolManager;
    this.aiProvider = aiProvider;
    this.appActionMapper = appActionMapper;
    
    this.vision = new VisionHandler(aiProvider, toolManager);
    this.learning = new CorrectionHandler(aiProvider, appActionMapper);
    this.userMemory = new UserMemory(aiProvider);
    this.knowledgeGraph = new KnowledgeGraph();
    
    this.MAX_STEPS = 60;
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
      this.knowledgeGraph.contextFor(rawInput)
    ]);

    // Passive Fact Extraction (Non-blocking)
    extractFacts(rawInput, this.aiProvider).then((res) => {
      if (res && res.facts && res.facts.length > 0) {
        res.facts.forEach(f => {
          this.knowledgeGraph.upsertFact({ ...f, source: 'passive_extraction' }).catch(() => {});
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
      graphContext: graphContext,
      intentData: null,
      domain: null, // 🧠 2. DOMAIN LOCK (IMMUTABLE)
      plan: [],
      currentStepIndex: 0,
      uiMap: null,
      uiMapSource: null,
      uiMapChecked: false,
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
    if (/\b(close|exit)\s+(this\s+)?(window|app)\b/.test(lower)) {
      return { tool: 'pressKey', args: { key: '%{F4}' }, moveNearActiveClose: true };
    }

    const moveMatch = lower.match(/\bmove\s+(?:to\s+)?(top left|top right|bottom left|bottom right|center)\b/);
    if (moveMatch) return { moveCommand: moveMatch[1] };

    const mediaCommands = ['play', 'pause', 'next', 'previous', 'skip', 'resume'];
    if (mediaCommands.includes(lower) || lower === 'play music' || lower === 'pause music') {
       return { tool: 'pressKey', args: { key: lower.includes('next') ? '{MEDIA_NEXT}' : lower.includes('prev') ? '{MEDIA_PREV}' : '{MEDIA_PLAY_PAUSE}' } };
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
    return args.label ||
      args.description ||
      args.query ||
      args.target ||
      args.element ||
      ctx.intentData?.goal ||
      ctx.rawInput;
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
      .replace(/[^0-9+\-*/().%\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _createDeterministicPlan(ctx) {
    const lower = String(ctx.rawInput || '').toLowerCase();
    const app = this._inferAppName(ctx);

    if (app === 'notepad' && /\b(write|type)\b/.test(lower)) {
      const text = this._extractTextToType(ctx.rawInput) || 'Reminder: drink water.';
      return [
        { tool: 'open_resource', input: { query: 'notepad' } },
        { tool: 'waitForAppReady', input: { appName: 'notepad' } },
        { tool: 'focusWindow', input: { appName: 'notepad' } },
        { tool: 'typeText', input: { text } }
      ];
    }

    if (app === 'chrome' && /\bsearch\b/.test(lower)) {
      const query = this._extractSearchText(ctx) || ctx.rawInput.replace(/open chrome/i, '').trim();
      return [
        { tool: 'open_resource', input: { query: 'chrome' } },
        { tool: 'waitForAppReady', input: { appName: 'chrome' } },
        { tool: 'focusWindow', input: { appName: 'chrome' } },
        { tool: 'pressKey', input: { key: '^l' } },
        { tool: 'typeText', input: { text: query } },
        { tool: 'pressKey', input: { key: '{ENTER}' } }
      ];
    }

    if (app === 'spotify' && /\b(play|search)\b/.test(lower)) {
      const query = this._extractSearchText(ctx);
      if (!query) return null;
      return [
        { tool: 'open_resource', input: { query: 'spotify' } },
        { tool: 'waitForAppReady', input: { appName: 'spotify' } },
        { tool: 'focusWindow', input: { appName: 'spotify' } },
        { tool: 'pressKey', input: { key: '^l' } },
        { tool: 'typeText', input: { text: query } },
        { tool: 'pressKey', input: { key: '{ENTER}' } }
      ];
    }

    if (/\bcalculate\b|\d+\s*(times|multiplied by|plus|minus|divided by|[+\-*/])\s*\d+/.test(lower)) {
      const expression = this._extractMathExpression(ctx);
      if (!expression) return null;

      if (app === 'calculator' && /\bopen\b/.test(lower)) {
        return [
          { tool: 'open_resource', input: { query: 'calculator' } },
          { tool: 'waitForAppReady', input: { appName: 'calculator' } },
          { tool: 'focusWindow', input: { appName: 'calculator' } },
          { tool: 'calculate', input: { expression } }
        ];
      }

      return [
        { tool: 'calculate', input: { expression } }
      ];
    }

    return null;
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

  async _handlePlanState(ctx) {
    if (DEBUG_MODE) console.log(`[AgentLoop] State: PLAN`);
    
    // Format RAG context for prompts
    let ragString = "";
    if (ctx.ragContext.facts.length > 0 || ctx.ragContext.workflows.length > 0) {
      ragString = "\n\nRelevant user knowledge:\n";
      if (ctx.ragContext.facts.length > 0) ragString += `Facts:\n- ${ctx.ragContext.facts.join('\n- ')}\n`;
      if (ctx.ragContext.workflows.length > 0) ragString += `Past Workflows:\n- ${ctx.ragContext.workflows.map(w => JSON.stringify(w)).join('\n- ')}\n`;
    }
    if (ctx.graphContext && ctx.graphContext.length > 0) {
      ragString += `${ragString ? '\n' : '\n\nRelevant user knowledge:\n'}Knowledge Graph:\n- ${ctx.graphContext.join('\n- ')}\n`;
    }

    // ⚙️ 2. LIGHT PATH (Parse Goal + Entities + Domain)
    ctx.intentData = await this.intentParser.parse(ctx.rawInput + ragString);
    
    // 🧠 2. DOMAIN LOCK
    if (!ctx.domain) {
      ctx.domain = ctx.intentData.domain;
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

    const deterministicPlan = this._createDeterministicPlan(ctx);
    if (deterministicPlan) {
      if (DEBUG_MODE) console.log(`[AgentLoop] Deterministic plan selected.`);
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
    const planResponse = await this.planner.createPlan(ctx.intentData.goal, ctx.intentData.entities, ctx.history, 1, ragString, ctx.uiMap || {});
    ctx.plan = this._sanitizePlan(ctx, planResponse.steps || []);

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

    // TRUE VALIDATION LOOP: Pre-action screenshot
    const { captureTempScreenshot, compareScreenshots } = await import('../../tools/system/verifyExecution.js');
    const beforeImg = await captureTempScreenshot(`before_${Date.now()}.png`);

    const result = await this.toolManager.execute(currentStep.tool, currentArgs);

    if (result.success && ['focusWindow', 'waitForAppReady'].includes(currentStep.tool)) {
      const activeAfterTool = await getActiveWindow();
      if (!this._windowMatchesExpected(activeAfterTool, currentArgs.appName)) {
        result.success = false;
        result.error = `${currentStep.tool} did not leave ${currentArgs.appName} active.`;
      }
    }
    
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

    if (ctx.retryCount < this.RETRY_LIMIT) {
      ctx.retryCount++;
      
      if (lastError && lastError.includes("Invalid tool")) {
        if (DEBUG_MODE) console.log(`[AgentLoop] Smart Recovery: Invalid tool detected. Re-planning with constraint...`);
        const constraint = `The previous plan failed because it used an invalid tool "${lastExecution.tool}". You MUST pick a strictly valid tool from the provided list.`;
        
        ctx.history.push({ action: 'constraint', error: constraint });
        const planResponse = await this.planner.createPlan(
          ctx.intentData.goal,
          ctx.intentData.entities,
          ctx.history,
          1,
          '',
          ctx.uiMap || {}
        );
        
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
         if (lastExecution.args?._uiMapId && !lastExecution.args?._uiMapFailureRecorded) {
           recordUIMapFailure(lastExecution.args._uiMapId);
         }
         if (DEBUG_MODE) console.log(`[AgentLoop] Fallback: refreshing UI map for click retry...`);

         const target = this._extractClickTarget(lastExecution.args || {}, ctx);
         const refreshedMap = await this._refreshUIMap(ctx, { force: true, persist: false });
         const refreshedElement = target && refreshedMap ? findElementInMap(refreshedMap, target) : null;

         if (refreshedElement) {
           ctx.plan[ctx.currentStepIndex].input = {
             ...(lastExecution.args || {}),
             x: refreshedElement.x,
             y: refreshedElement.y,
             _uiMapLabel: refreshedElement.label,
             _uiMapTransient: true
           };
           ctx.state = STATE.EXECUTE;
           return;
         }

         if (DEBUG_MODE) console.log(`[AgentLoop] Fallback: engaging point vision for click...`);
         const visionResult = await this.toolManager.execute('locateUIElement', { description: target }, this.aiProvider);
         const point = this._extractLocatedPoint(visionResult);
         if (point) {
           ctx.plan[ctx.currentStepIndex].input = {
             ...(lastExecution.args || {}),
             x: point.x,
             y: point.y,
             _visionLocated: true
           };
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
