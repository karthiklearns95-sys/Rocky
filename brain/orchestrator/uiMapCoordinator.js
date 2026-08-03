import getActiveWindow from '../../automation/system/getActiveWindow.js';
import getUIElements from '#tools/system/getUIElements.js';
import { captureUIVisualSignature } from '#tools/system/uiVisualSignature.js';
import {
  getUIMapCandidates,
  validateUIMap,
  saveUIMap,
} from '#memory/uiMapStore.js';

const DEBUG_MODE = process.env.NODE_ENV !== 'production';

/**
 * UIMapCoordinator
 *
 * Handles all UI map loading, validation, and refresh orchestration for AgentLoop.
 * Extracted from agentLoop.js to keep the orchestrator thin.
 *
 * Responsibilities:
 * - Building enriched window snapshots (window info + UIA element tree)
 * - Loading and validating cached UI maps against the live window state
 * - Running live UI analysis when the cache misses
 * - Deciding when to defer UI discovery (keyboard-only steps, etc.)
 * - Persisting newly discovered UI maps to the store
 */
export class UIMapCoordinator {
  constructor(toolManager) {
    this.toolManager = toolManager;
  }

  /**
   * Builds a window snapshot enriched with UIA elements.
   */
  async buildWindowSnapshot(activeWindow = null) {
    const windowInfo = activeWindow || await getActiveWindow();
    if (!windowInfo || windowInfo.isMinimized) return windowInfo;

    const uiResult = await getUIElements({ foregroundOnly: true, maxElements: 200 });
    return {
      ...windowInfo,
      uiElements: uiResult.success ? uiResult.elements : [],
    };
  }

  /**
   * Checks window title + app name similarity for task validation.
   */
  windowMatchesExpected(windowInfo, expected) {
    if (!expected || !windowInfo) return true;
    const needle = String(expected).toLowerCase();
    const app = String(windowInfo.appName || '').toLowerCase();
    const title = String(windowInfo.windowTitle || '').toLowerCase();
    return app.includes(needle) || needle.includes(app) || title.includes(needle);
  }

  /**
   * Try to attach a validated cached UI map to the context.
   * Returns the map if found, null if none passed validation.
   */
  async attachValidatedUIMap(ctx, activeWindow = ctx.activeWindow) {
    const snapshot = await this.buildWindowSnapshot(activeWindow);
    ctx.activeWindow = snapshot;

    const candidates = getUIMapCandidates(snapshot?.appName, snapshot?.windowTitle);
    for (const candidate of candidates) {
      const liveSignature = candidate.visualSignature
        ? await captureUIVisualSignature(candidate.elements)
        : null;
      const validation = validateUIMap(
        { ...snapshot, visualSignature: liveSignature },
        candidate
      );

      if (!validation.valid) {
        if (DEBUG_MODE) {
          console.log(`[UIMapCoordinator] UI map rejected: ${validation.reasons.join(', ')}.`);
        }
        continue;
      }

      const validMap = { ...candidate, validation };
      ctx.uiMap = validMap;
      ctx.uiMapSource = 'cache';
      ctx.uiMapChecked = true;

      if (DEBUG_MODE) {
        console.log(`[UIMapCoordinator] UI map cache hit for ${validMap.app} (${validMap.elements.length} elements).`);
      }

      return validMap;
    }

    return null;
  }

  /**
   * Force a live UI analysis and persist the result.
   * Falls back to cache if the live analysis fails or has low confidence.
   */
  async refreshUIMap(ctx, aiProvider, options = {}) {
    const { force = false, persist = true, executionSucceeded = true } = options;
    const snapshot = await this.buildWindowSnapshot(await getActiveWindow());
    ctx.activeWindow = snapshot;

    if (!force) {
      const validMap = await this.attachValidatedUIMap(ctx, snapshot);
      if (validMap) return validMap;
    }

    if (DEBUG_MODE) console.log(`[UIMapCoordinator] Running live UI analysis for ${snapshot?.appName || 'unknown'}...`);
    const analysis = await this.toolManager.execute('analyze_ui', { currentWindow: snapshot }, aiProvider);
    ctx.uiMapChecked = true;

    if (!analysis.success || !analysis.uiMap) {
      if (DEBUG_MODE) console.log(`[UIMapCoordinator] UI analysis failed: ${analysis.error || 'unknown error'}`);
      return null;
    }

    const visualSignature = await captureUIVisualSignature(analysis.uiMap.elements);
    const uiMap = { ...analysis.uiMap, visualSignature };

    if (persist) {
      const saved = saveUIMap(snapshot.appName, snapshot.windowTitle, uiMap, {
        currentWindow: snapshot,
        executionSucceeded,
      });

      if (saved.saved) {
        ctx.uiMap = saved.map;
        ctx.uiMapSource = 'vision';
        return saved.map;
      }

      if (DEBUG_MODE) console.log(`[UIMapCoordinator] UI map not persisted: ${saved.reason}`);
    }

    ctx.uiMap = uiMap;
    ctx.uiMapSource = 'vision_transient';
    return uiMap;
  }

  /**
   * Determines whether the active app UI should be loaded before planning.
   * Avoids loading the map when the user is launching a different app.
   */
  shouldLoadActiveUIMap(ctx) {
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

  /**
   * Returns true if UI discovery should be deferred until after the current step.
   * Avoids expensive analysis before keyboard-only sequences.
   */
  shouldDeferUIDiscovery(ctx, currentStep) {
    const remainingTools = ctx.plan
      .slice(ctx.currentStepIndex + 1)
      .map((step) => step.tool);

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

  /**
   * After a resource-opening step succeeds, opportunistically discover and
   * cache the UI map for the newly opened application.
   */
  async maybeResolveUIMapAfterStep(ctx, currentStep, result, aiProvider) {
    if (!result?.success) return;
    if (!['open_resource', 'waitForAppReady', 'focusWindow'].includes(currentStep.tool)) return;
    if (ctx.uiMap && ctx.uiMapSource === 'cache') return;
    if (this.shouldDeferUIDiscovery(ctx, currentStep)) return;

    const active = await getActiveWindow();
    const expectedApp = currentStep.input?.appName || currentStep.input?.query;
    if (expectedApp && !this.windowMatchesExpected(active, expectedApp)) {
      if (DEBUG_MODE) console.log(`[UIMapCoordinator] Skipping UI map analysis: active window is not ${expectedApp}.`);
      return;
    }

    const validMap = await this.attachValidatedUIMap(ctx, active);
    if (validMap) return;

    await this.refreshUIMap(ctx, aiProvider, {
      force: true,
      persist: true,
      executionSucceeded: result.success,
    });
  }
}
