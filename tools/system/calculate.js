/**
 * Calculate tool — evaluates math expressions directly in Node.js.
 * No need to open Calculator for basic operations.
 */
export default async function calculate(args) {
  const { expression } = args;
  if (!expression) return "Grace, what should Rocky calculate?";

  console.log(`[Tool: calculate] Evaluating: ${expression}`);

  try {
    // 1. Inject screen metrics if width/height are mentioned
    let finalExpression = expression;
    if (expression.includes('width') || expression.includes('height')) {
      const getSystemMetrics = (await import('../../automation/system/getSystemMetrics.js')).default;
      const metrics = await getSystemMetrics();
      finalExpression = expression
        .replace(/width/g, metrics.width)
        .replace(/height/g, metrics.height);
    }

    // 2. Clean the expression — allow only safe math characters
    const safe = finalExpression
      .replace(/[^0-9+\-*/().%\s^]/g, '')  // strip unsafe chars
      .replace(/\^/g, '**')                  // support ^ as power
      .trim();

    if (!safe) return `Grace, Rocky cannot parse "${expression}" as a math expression.`;

    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${safe})`)();

    if (typeof result !== 'number' || !isFinite(result)) {
      return `Grace, the math gave an invalid result for "${expression}".`;
    }

    return `Grace, ${expression} = ${result}. Amaze.`;
  } catch (err) {
    console.error('[Tool: calculate] Error:', err.message);
    return `Grace, Rocky could not calculate "${expression}". Try a simpler expression.`;
  }
}
