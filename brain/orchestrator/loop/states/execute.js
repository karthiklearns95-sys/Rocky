import process from 'process';
import getActiveWindow from '../../../../automation/system/getActiveWindow.js';
import getSystemMetrics from '../../../../automation/system/getSystemMetrics.js';
import { loadDisplays, displayAt } from '../../../../automation/system/displays.js';
import { appCatalog } from '../../../../resolver/installedApps.js';
import { screenChanged } from '#tools/system/screenCache.js';
import { recordUIMapFailure, recordUIMapSuccess, saveUIMap } from '#memory/uiMapStore.js';
import { withGuard } from '../../../runtime/executionGuard.js';
import { STATE, DOMAIN_TOOLS, DEBUG_MODE } from '../constants.js';

/**
 * EXECUTE: run the current step of the plan.
 *
 *   1. check the tool is allowed here and exists
 *   2. fill in the step's arguments ($LAST_OUTPUT from the previous step)
 *   3. prepare special tools: open_resource (find what to open), analyze_ui, mouseClick (find where)
 *   4. run the tool, then check the result (right window in front? did the click change anything?)
 *   5. record it in the history and hand over to VALIDATE
 */
export async function handleExecuteState(loop, ctx, signal) {
  if (signal?.aborted) return;
  if (DEBUG_MODE) console.log(`[AgentLoop] State: EXECUTE (Step ${ctx.currentStepIndex + 1}/${ctx.plan.length})`);
  const currentStep = ctx.plan[ctx.currentStepIndex];

  if (!stepIsAllowed(loop, ctx, currentStep)) return;

  const lastResult = ctx.history.length > 0 ? ctx.history[ctx.history.length - 1].result : null;
  let currentArgs = injectLastOutput(currentStep.input || {}, lastResult);

  if (DEBUG_MODE) {
    console.log(`[AgentLoop] Executing Tool: ${currentStep.tool}`);
    console.log(`[AgentLoop] Input Args:`, currentArgs);
  }

  // Global Resource Execution Pipeline
  if (currentArgs.query && currentStep.tool === 'open_resource') {
    if (!(await resolveOpenResource(loop, ctx, currentArgs))) return;
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
    currentArgs = await prepareClick(loop, ctx, currentArgs);
  }

  // A click only counts if something visibly happened. Everything else relies on its own result.
  const isClick = currentStep.tool === 'mouseClick';
  const clickCheck = isClick ? await beginClickCheck(loop, currentArgs) : null;

  // Inject the abort signal into the tool arguments so tools can halt midway.
  currentArgs._signal = ctx.signal;

  const result = await runTool(loop, ctx, currentStep, currentArgs);
  screenChanged(); // whatever the tool did, earlier UI-tree / OCR reads may now be stale

  // Remember which installed apps Grace really uses, so close calls resolve her way next time.
  if (result.success && currentStep.tool === 'open_resource' && currentArgs.resource?.source === 'catalog') {
    appCatalog.recordLaunch(currentArgs.resource.appId);
  }

  if (result.success && ['focusWindow', 'waitForAppReady'].includes(currentStep.tool)) {
    const activeAfterTool = await getActiveWindow();
    if (!loop.uiMapCoordinator.windowMatchesExpected(activeAfterTool, currentArgs.appName)) {
      result.success = false;
      result.error = `${currentStep.tool} did not leave ${currentArgs.appName} active.`;
    }
  }

  if (!isClick) {
    ctx.history.push({ tool: currentStep.tool, args: currentArgs, result });
    if (result.success) {
      await loop.uiMapCoordinator.maybeResolveUIMapAfterStep(ctx, currentStep, result, loop.aiProvider);
    }
    ctx.state = STATE.VALIDATE;
    return;
  }

  await settleClick(loop, ctx, currentStep, currentArgs, result, clickCheck);
  ctx.history.push({ tool: currentStep.tool, args: currentArgs, result });
  ctx.state = STATE.VALIDATE;
}

// ── 1. Is this step allowed? ───────────────────────────────────────────────

/** Tool whitelist per domain, and the tool must exist. On a refusal, sets RECOVER and returns false. */
function stepIsAllowed(loop, ctx, currentStep) {
  // 🧠 4. TOOL VALIDATION (Whitelisting)
  if (!ctx.domain || !DOMAIN_TOOLS[ctx.domain]) {
    ctx.domain = 'conversation';
  }

  if (!DOMAIN_TOOLS[ctx.domain].includes(currentStep.tool)) {
    const error = `SECURITY: Tool "${currentStep.tool}" is forbidden in ${ctx.domain} domain.`;
    console.error(`[AgentLoop] ${error}`);
    ctx.history.push({ action: 'fail', error });
    ctx.state = STATE.RECOVER;
    return false;
  }

  if (!loop.toolManager.has(currentStep.tool)) {
    ctx.history.push({ action: 'fail', error: `Invalid tool hallucinated: ${currentStep.tool}` });
    ctx.state = STATE.RECOVER;
    return false;
  }
  return true;
}

// ── 2. Arguments ───────────────────────────────────────────────────────────

/**
 * Variable injection: $LAST_OUTPUT (or $LAST_OUTPUT.path.to.field) in a string argument is replaced
 * with the previous step's output. With no previous result the arguments are returned untouched
 * (the very same object).
 */
export function injectLastOutput(args, lastResult) {
  if (!(lastResult && args)) return args;

  const currentArgs = JSON.parse(JSON.stringify(args));
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
  return currentArgs;
}

// ── 3. Special tools ───────────────────────────────────────────────────────

/**
 * open_resource: work out what "spotify" / "youtube" / "notepad++" means (installed app, website...).
 * Returns false when it ended the run instead (unknown name, or two apps fit equally: ask Grace).
 */
async function resolveOpenResource(loop, ctx, currentArgs) {
  const resolveResource = (await import('../../../../resolver/resourceResolver.js')).default;
  const resolveCapabilities = (await import('../../../../resolver/capabilityResolver.js')).default;

  const resource = await resolveResource(currentArgs.query, ctx, loop.appActionMapper);

  if (resource.type === 'unknown') {
    if (DEBUG_MODE) console.log(`[AgentLoop] Unknown resource requested. Asking user.`);
    ctx.history.push({ action: 'fail', error: `Unknown resource: ${currentArgs.query}` });
    ctx.directResponse = resource.reason === 'not_installed'
      ? `Grace, Rocky cannot find an app called "${currentArgs.query}" on this computer. Is it a website?`
      : `Grace, I'm not sure what "${currentArgs.query}" is. Is it a desktop app or a website?`;
    ctx.state = STATE.COMPLETE;
    return false;
  }

  // Two installed apps fit equally well and Grace has no habit that decides it: ask, don't guess.
  if (resource.ambiguous && resource.alternatives?.length) {
    ctx.history.push({ action: 'fail', error: `Ambiguous app: ${currentArgs.query}` });
    ctx.directResponse = `Grace, Rocky found ${resource.displayName} and ${resource.alternatives[0]}. Which one?`;
    ctx.state = STATE.COMPLETE;
    return false;
  }

  const capabilities = resolveCapabilities(resource);
  currentArgs.resource = resource;
  currentArgs.capabilities = capabilities;

  if (DEBUG_MODE) console.log(`[AgentLoop] Resolved Resource:`, resource, `\nCapabilities:`, capabilities);
  return true;
}

/** mouseClick: work out where to click, and let Rocky's avatar walk over first. */
async function prepareClick(loop, ctx, currentArgs) {
  const args = await loop.clickResolver.resolveMouseClickArgs(ctx, currentArgs, loop.aiProvider);
  if (DEBUG_MODE) console.log(`[AgentLoop] Resolved mouseClick args:`, args);
  loop.clickResolver.moveNearPoint(args.x, args.y, args._uiMapLabel || args.label || 'click_target');
  await new Promise(resolve => setTimeout(resolve, 200)); // lets Rocky's avatar walk over
  return args;
}

// ── 4. Run the tool and check what happened ────────────────────────────────

/**
 * Two snapshots before the click show what is already animating (cursor, spinner), so only a
 * real change afterwards counts. Returns { session, windowBefore }.
 */
async function beginClickCheck(loop, args) {
  const { beginClickVerification } = await import('#tools/system/verifyExecution.js');
  // The monitor the click lands on is the only one watched (cached for a few seconds, so this is cheap).
  const displays = await loadDisplays({ fallback: getSystemMetrics }).catch(() => null);
  const display = displays?.length ? displayAt(displays, { x: args.x, y: args.y }) : null;
  const windowBefore = await getActiveWindow().catch(() => null);
  // Hover first, so a button's hover highlight is part of the "before" picture.
  const { hoverAt } = await import('#tools/system/guiControl.js');
  if (await hoverAt(args.x, args.y)) await new Promise(r => setTimeout(r, 120));
  const session = await beginClickVerification(
    { x: args.x, y: args.y },
    { display }
  );
  return { session, windowBefore };
}

async function runTool(loop, ctx, currentStep, currentArgs) {
  try {
    process.emit('aura_telemetry', { status: 'executing', target: 'UIA_Daemon' });
    return await withGuard(
      loop.toolManager.execute(currentStep.tool, currentArgs),
      ctx.signal,
      `tool_${currentStep.tool}`
    );
  } catch (err) {
    if (err.name === 'AbortError') throw err; // Bubble up to process() loop
    return { success: false, error: err.message };
  }
}

/**
 * Pixel validation for mouseClick: watch the screen for a real change. 'unknown' (the screen could
 * not be read) trusts the tool, as it always did. Updates the UI-map confidence bookkeeping.
 */
async function settleClick(loop, ctx, currentStep, currentArgs, result, clickCheck) {
  let verdict = { verdict: 'unknown', reason: 'not checked' };
  if (result.success) {
    const { finishClickVerification } = await import('#tools/system/verifyExecution.js');
    verdict = await finishClickVerification(clickCheck.session, {
      windowChanged: async () => {
        const now = await getActiveWindow();
        const before = clickCheck.windowBefore;
        return !!(before && now &&
          (now.appName !== before.appName || now.windowTitle !== before.windowTitle));
      }
    });
  }
  result.verification = verdict;
  if (DEBUG_MODE) console.log(`[AgentLoop] Click verification:`, verdict);

  if (verdict.verdict === 'unchanged') {
    if (DEBUG_MODE) console.log(`[AgentLoop] True Validation Failed: UI did not change.`);
    result.success = false;
    result.error = 'UI unchanged after click.';
    if (currentArgs._uiMapId) {
      recordUIMapFailure(currentArgs._uiMapId);
      currentArgs._uiMapFailureRecorded = true;
    }
  } else if (result.success) {
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

    // 👁️ UI DISCOVERY: If we just opened a desktop app, analyze it
    await loop.uiMapCoordinator.maybeResolveUIMapAfterStep(ctx, currentStep, result, loop.aiProvider);
  } else if (currentArgs._uiMapId) {
    recordUIMapFailure(currentArgs._uiMapId);
  }
}
