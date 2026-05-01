import { ROCKY_SYSTEM_PROMPT, formatResponse } from '../personality/rockyPersonality.js';

export default class ResponseFormatter {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  async format(intentResult, executionResults) {
    console.log(`[ResponseFormatter] Formatting response for intent: ${intentResult.intent}`);

    const prompt = `
${ROCKY_SYSTEM_PROMPT}

---

The user's intent was: "${intentResult.intent || 'talk'}"
Tool execution results: ${JSON.stringify(executionResults || [])}

Respond as Rocky now. Keep it short. 2-3 sentences max.
    `.trim();

    // Get raw response from AI provider (real or mock)
    const rawText = await this.aiProvider.generate(prompt);

    // Apply Rocky's personality post-processing
    const styledResponse = formatResponse(rawText);

    console.log(`[ResponseFormatter] Final response: "${styledResponse}"`);
    return styledResponse;
  }
}
