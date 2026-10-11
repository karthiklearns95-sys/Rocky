import { ROCKY_SYSTEM_PROMPT, formatResponse } from '#brain/personality/rockyPersonality.js';

/** Rocky tells Grace, briefly, how the task went (from the tool history). */
export async function generateFinalResponse(loop, ctx) {
  const summary = ctx.history.map((h) => {
    if (!h.result) return `${h.tool || h.action}: Done`;
    const status = h.result.success ? 'Done' : 'Fail';
    const data = h.result.data ? ` (${typeof h.result.data === 'string' ? h.result.data : JSON.stringify(h.result.data)})` : '';
    const error = h.result.error ? ` (${h.result.error})` : '';
    return `${h.tool || h.action}: ${status}${data}${error}`;
  }).join(', ');
  const prompt = `${ROCKY_SYSTEM_PROMPT}\n\nTask: ${ctx.userText}\nSummary: ${summary}\n\nRespond briefly.`;
  const resp = await loop.aiProvider.generate(prompt);
  return formatResponse(resp || "Rocky finished. Amaze.");
}
