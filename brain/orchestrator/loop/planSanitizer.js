import { inferAppName, extractTextToType, extractSearchText, extractMathExpression } from '../planUtils.js';

/**
 * Clean up a plan from the router, the cache or the LLM: fill placeholders and missing inputs
 * (app name, text to type, expression) from the request, and drop steps that still cannot run.
 */
export function sanitizePlan(ctx, steps = []) {
  const app = inferAppName(ctx);
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
        next.input.text = extractTextToType(ctx.userText) || extractSearchText(ctx) || '';
      }

      if (next.tool === 'calculate' && !next.input.expression) {
        next.input.expression = extractMathExpression(ctx);
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
