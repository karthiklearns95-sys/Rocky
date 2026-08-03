import eventBus from '#services/eventBus.js';
import getActiveWindow from '../../automation/system/getActiveWindow.js';
import { findElementInMap, validateUIMap, recordUIMapFailure } from '#memory/uiMapStore.js';
import { captureUIVisualSignature } from '#tools/system/uiVisualSignature.js';

const DEBUG_MODE = process.env.NODE_ENV !== 'production';

/**
 * ClickResolver
 *
 * Handles all mouse-click coordinate resolution for AgentLoop.
 * Extracted from agentLoop.js to keep the orchestrator thin.
 *
 * Responsibilities:
 * - Resolving click target labels from plan step arguments
 * - Matching targets against the cached UI map
 * - Falling back to vision/OCR location when the map misses
 * - Emitting the MOVE_AGENT event to animate Rocky toward the click target
 */
export class ClickResolver {
  constructor(toolManager) {
    this.toolManager = toolManager;
  }

  /**
   * Emit a MOVE_AGENT event to animate Rocky near a screen point.
   */
  moveNearPoint(x, y, label = 'target') {
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return;
    eventBus.emit('MOVE_AGENT', {
      x: Math.round(Number(x)),
      y: Math.round(Number(y)),
      anchor: 'near',
      label,
    });
  }

  /**
   * Extract the human-readable click target from plan step arguments.
   * Rejects goal-name strings (e.g. 'open_and_play_song') — they are intent goals, not UI labels.
   */
  extractClickTarget(args, ctx) {
    const isGoalName = (s) => typeof s === 'string' && /^[a-z][a-z0-9_]+$/.test(s) && s.includes('_');

    const candidate = args.label || args.description || args.query || args.target || args.element;

    if (candidate && !isGoalName(candidate)) return candidate;

    const goal = ctx.intentData?.goal;
    if (goal && !isGoalName(goal)) return goal;

    const raw = String(ctx.rawInput || '');
    const quoted = raw.match(/["'''""](.+?)["'''""]/) ;
    if (quoted) return quoted[1];

    const noun = raw.toLowerCase().replace('rocky', '').trim();
    return noun.length > 2 ? noun : null;
  }

  /**
   * Parse a located point from a tool result, validating coordinates are finite and positive.
   */
  extractLocatedPoint(toolResult) {
    const point = toolResult?.data || toolResult;
    if (!toolResult?.success && !point?.x) return null;
    if (point?.error) return null;

    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
    return { ...point, x, y };
  }

  /**
   * Check whether a screen point falls within any element in a UI map.
   */
  pointMatchesUIMap(map, x, y, target = null) {
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

  /**
   * Full click resolution pipeline:
   * 1. Check cached UI map for the target label
   * 2. Validate coordinates against the UI map if they're already numeric
   * 3. Re-analyze the UI if the map is stale
   * 4. Fall back to LLaVA vision as last resort
   *
   * @param {object} ctx - Agent context.
   * @param {object} args - Raw tool arguments from the plan step.
   * @param {object} aiProvider - AI provider for vision fallback.
   * @returns {Promise<object>} Resolved args with x, y coordinates.
   */
  async resolveMouseClickArgs(ctx, args, aiProvider) {
    const resolved = { ...args };
    const target = this.extractClickTarget(resolved, ctx);
    const lastTool = ctx.history[ctx.history.length - 1]?.tool;
    const hasNumericPoint = Number.isFinite(Number(resolved.x)) && Number.isFinite(Number(resolved.y));

    if (!ctx.uiMap) {
      await this._attachValidatedMapToCtx(ctx);
    } else if (ctx.uiMapSource === 'cache') {
      const snapshot = await this._buildWindowSnapshot(await getActiveWindow());
      const validation = validateUIMap(snapshot, ctx.uiMap);
      ctx.activeWindow = snapshot;

      if (!validation.valid) {
        if (DEBUG_MODE) console.log(`[ClickResolver] Cached UI map rejected before click: ${validation.reasons.join(', ')}`);
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
          _uiMapTransient: !ctx.uiMap.id,
        };
      }
    }

    if (hasNumericPoint && ctx.uiMap && this.pointMatchesUIMap(ctx.uiMap, Number(resolved.x), Number(resolved.y), target)) {
      return {
        ...resolved,
        x: Number(resolved.x),
        y: Number(resolved.y),
        _uiMapId: ctx.uiMap.id,
        _uiMapTransient: !ctx.uiMap.id,
      };
    }

    if (hasNumericPoint && lastTool === 'locateUIElement') {
      return { ...resolved, x: Number(resolved.x), y: Number(resolved.y), _visionLocated: true };
    }

    // Vision fallback
    const visionResult = await this.toolManager.execute('locateUIElement', { description: target }, aiProvider);
    const point = this.extractLocatedPoint(visionResult);
    if (point) {
      return { ...resolved, x: point.x, y: point.y, _visionLocated: true };
    }

    return resolved;
  }

  // Private helper: thin wrapper to share snapshot logic without importing UIMapCoordinator
  async _buildWindowSnapshot(activeWindow) {
    const getUIElements = (await import('#tools/system/getUIElements.js')).default;
    if (!activeWindow || activeWindow.isMinimized) return activeWindow;
    const uiResult = await getUIElements({ foregroundOnly: true, maxElements: 200 });
    return {
      ...activeWindow,
      uiElements: uiResult.success ? uiResult.elements : [],
    };
  }

  async _attachValidatedMapToCtx(ctx) {
    const { getUIMapCandidates, validateUIMap: validate } = await import('#memory/uiMapStore.js');
    const snapshot = await this._buildWindowSnapshot(await getActiveWindow());
    ctx.activeWindow = snapshot;
    const candidates = getUIMapCandidates(snapshot?.appName, snapshot?.windowTitle);
    for (const candidate of candidates) {
      const liveSignature = candidate.visualSignature
        ? await captureUIVisualSignature(candidate.elements)
        : null;
      const validation = validate({ ...snapshot, visualSignature: liveSignature }, candidate);
      if (validation.valid) {
        ctx.uiMap = { ...candidate, validation };
        ctx.uiMapSource = 'cache';
        ctx.uiMapChecked = true;
        return;
      }
    }
  }
}
