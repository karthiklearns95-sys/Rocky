import getActiveWindow from '../../../../automation/system/getActiveWindow.js';
import { execWithTimeout } from '../../../../automation/system/execWithTimeout.js';
import { recordUIMapFailure } from '#memory/uiMapStore.js';
import { STATE, DEBUG_MODE } from '../constants.js';

/**
 * RECOVER: the last step failed. Try the strategies below in order; the first that finds a way
 * forward sets the next state. If none does, retry the same step. After RETRY_LIMIT attempts,
 * give up and ask Grace what she sees.
 *
 * Each strategy returns true when it has decided what happens next, false to let the next one try.
 */
export async function handleRecoverState(loop, ctx) {
  if (DEBUG_MODE) console.log(`[AgentLoop] State: RECOVER (Retry ${ctx.retryCount}/${loop.RETRY_LIMIT})`);
  const lastExecution = ctx.history[ctx.history.length - 1] || {};
  const failure = {
    lastExecution,
    lastError: lastExecution.error || lastExecution.result?.error || '',
    lastTool: lastExecution.tool || ctx.plan[ctx.currentStepIndex]?.tool,
    lastArgs: lastExecution.args || ctx.plan[ctx.currentStepIndex]?.input || {},
  };

  if (ctx.retryCount >= loop.RETRY_LIMIT) {
    console.log(`[AgentLoop] Recovery exhausted after ${loop.RETRY_LIMIT} retries.`);
    ctx.history.push({ action: 'fail', error: 'Max retries reached.' });
    ctx.directResponse = "I ran into a wall on that one. Can you tell me what you see on screen?";
    ctx.state = STATE.COMPLETE;
    return;
  }

  ctx.retryCount++;

  for (const strategy of [replanAfterInvalidTool, recoverFailedClick, recoverAppActivation]) {
    if (await strategy(loop, ctx, failure)) return;
  }

  // ── Default: just retry the same step ─────────────────────────────────
  console.log(`[AgentLoop] Recovery: retrying ${failure.lastTool} (attempt ${ctx.retryCount})...`);
  ctx.state = STATE.EXECUTE;
}

// ── Strategy 1: Invalid tool — re-plan with hard constraint ──
async function replanAfterInvalidTool(loop, ctx, { lastError, lastTool }) {
  if (!(lastError && lastError.includes('Invalid tool'))) return false;

  const constraint = `Previous plan failed: invalid tool "${lastTool}". Only use tools from the provided list.`;
  ctx.history.push({ action: 'constraint', error: constraint });
  const planResponse = await loop.planner.createPlan(
    ctx.intentData.goal, ctx.intentData.entities, ctx.history, 1, '', ctx.uiMap || {}
  );
  if (planResponse.steps?.length > 0) {
    ctx.plan = planResponse.steps;
    ctx.currentStepIndex = 0;
    ctx.state = STATE.EXECUTE;
    return true;
  }
  return false;
}

// Typing a shortcut is a good substitute for clicking these.
const KEYBOARD_FALLBACKS = {
  'search': '^f', 'find': '^f', 'address bar': '^l', 'url': '^l',
  'new tab': '^t', 'close': '{ESC}', 'back': '%{LEFT}', 'forward': '%{RIGHT}',
};

// ── Strategy 2: Click failure ────────────────────────────────
// Always decides the outcome (returns true) for a failed click: OCR, then a keyboard shortcut,
// then vision, otherwise tell Grace.
async function recoverFailedClick(loop, ctx, { lastExecution, lastTool, lastArgs }) {
  if (lastTool !== 'mouseClick') return false;

  if (lastExecution.args?._uiMapId) recordUIMapFailure(lastExecution.args._uiMapId);

  const target = loop.clickResolver.extractClickTarget(lastArgs, ctx);
  if (!target) {
    ctx.directResponse = "I couldn't identify what to click. Can you describe it?";
    ctx.state = STATE.COMPLETE;
    return true;
  }

  // Strategy 2a: Try OCR first (fast, ~200ms)
  console.log(`[AgentLoop] Recovery: trying OCR for "${target}"...`);
  try {
    const ocrResult = await loop.toolManager.execute('ocrSearch', { query: target });
    const ocrPoint = ocrResult?.data || ocrResult;
    if (ocrPoint?.x > 0 && ocrPoint?.y > 0) {
      console.log(`[AgentLoop] Recovery: OCR found "${target}" at (${ocrPoint.x}, ${ocrPoint.y})`);
      ctx.plan[ctx.currentStepIndex].input = { ...lastArgs, x: ocrPoint.x, y: ocrPoint.y, _ocrLocated: true };
      ctx.state = STATE.EXECUTE;
      return true;
    }
  } catch (e) {
    console.log(`[AgentLoop] Recovery: OCR failed (${e.message}), trying vision...`);
  }

  // Strategy 2b: Keyboard shortcut fallback for known targets
  const lowerTarget = String(target).toLowerCase();
  const kbFallback = Object.entries(KEYBOARD_FALLBACKS).find(([k]) => lowerTarget.includes(k));
  if (kbFallback) {
    console.log(`[AgentLoop] Recovery: keyboard fallback for "${target}" → ${kbFallback[1]}`);
    ctx.plan[ctx.currentStepIndex] = { tool: 'pressKey', input: { key: kbFallback[1] } };
    ctx.state = STATE.EXECUTE;
    return true;
  }

  // Strategy 2c: LLaVA vision (last resort, slow)
  if (ctx.retryCount <= 1) {
    console.log(`[AgentLoop] Recovery: LLaVA vision fallback for "${target}"...`);
    const visionResult = await loop.toolManager.execute('locateUIElement', { description: target }, loop.aiProvider);
    const point = loop.clickResolver.extractLocatedPoint(visionResult);
    if (point) {
      ctx.plan[ctx.currentStepIndex].input = { ...lastArgs, x: point.x, y: point.y, _visionLocated: true };
      ctx.state = STATE.EXECUTE;
      return true;
    }
  }

  // All strategies failed
  ctx.directResponse = `I couldn't find "${target}" on screen to click it.`;
  ctx.state = STATE.COMPLETE;
  return true;
}

// ── Strategy 3: App open/focus failure ────────────────────────
async function recoverAppActivation(loop, ctx, { lastTool, lastArgs }) {
  if (!['open_resource', 'focusWindow', 'waitForAppReady'].includes(lastTool)) return false;

  const appName = lastArgs.appName || lastArgs.query;
  if (!appName) return false;

  // Try bringing the window forward using UIA
  // appName comes from the LLM plan — pass it via env and match it literally, never interpolate it.
  const switchCmd = `powershell -NoProfile -NonInteractive -Command "$name = [regex]::Escape($env:ROCKY_APP_NAME); $proc = Get-Process | Where-Object { $_.MainWindowTitle -match $name } | Select-Object -First 1; if ($proc) { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) }"`;
  await execWithTimeout(switchCmd, { timeoutMs: 5000, env: { ROCKY_APP_NAME: String(appName) } });
  await new Promise(r => setTimeout(r, 800));
  // Re-check if the window is now active
  const active = await getActiveWindow();
  if (loop.uiMapCoordinator.windowMatchesExpected(active, appName)) {
    console.log(`[AgentLoop] Recovery: window for "${appName}" activated via AppActivate.`);
    ctx.state = STATE.EXECUTE;
    return true;
  }
  return false;
}
