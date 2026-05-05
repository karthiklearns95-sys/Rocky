/**
 * CorrectionHandler - Handles real-time user teaching.
 * Converts "Rocky, use Ctrl+P for print" -> Permanent App Profile update.
 */
export default class CorrectionHandler {
  constructor(aiProvider, appActionMapper) {
    this.aiProvider = aiProvider;
    this.appActionMapper = appActionMapper;
  }

  async handleCorrection(rawInput, appContext) {
    console.log(`[CorrectionHandler] Parsing user correction: "${rawInput}" for app: ${appContext.appName}`);

    const prompt = `
      Extract the learning intent from this user correction: "${rawInput}"
      Active App: ${appContext.appName}

      Respond ONLY with JSON:
      {
        "targetIntent": "the generic intent (e.g. print, save, click_send)",
        "actionType": "pressKey or mouseClick",
        "actionData": "keys to press (e.g. ^p) OR description to click"
      }
    `;

    try {
      let result = await this.aiProvider.generateStructured(prompt, {
        type: "object",
        properties: {
          targetIntent: { type: "string" },
          actionType: { type: "string" },
          actionData: { type: "string" },
          preferredType: { type: "string" } // "desktop" | "web" | "hybrid"
        }
      });

      // REGEX FALLBACK: If AI fails
      if (!result || !result.actionData) {
        console.log('[CorrectionHandler] AI failed parsing. Trying regex fallback...');
        const keyMatch = rawInput.match(/(ctrl\+[a-z]|alt\+[a-z]|shift\+[a-z]|\{[a-z]+\})/i);
        if (keyMatch) {
          result = {
            targetIntent: 'generic_action',
            actionType: 'pressKey',
            actionData: keyMatch[0].toLowerCase().replace('ctrl', '^').replace('alt', '%').replace('shift', '+')
          };
        }
      }

      if (result && result.targetIntent && result.actionData) {
        const payload = {
          app: appContext.appName,
          intent: result.targetIntent,
          action: result.actionData,
          confidence: 1.0,
          tool: result.actionType || 'pressKey'
        };

        // Override LLM decisions: save to AppActionMapper persistent Knowledge Graph
        await this.appActionMapper.saveLearnedMapping(
          appContext.appName, 
          result.targetIntent, 
          { 
            tool: payload.tool, 
            args: { key: payload.actionData, preferredType: result.preferredType }, 
            confidence: payload.confidence 
          }
        );
        return { success: true, data: `Grace... Rocky has learned. For ${result.targetIntent} in ${appContext.appName}, Rocky will use ${payload.actionData}. Amaze.` };
      }
      return { success: false, error: "Grace... Rocky is confused. What should I learn exactly?" };
    } catch (e) {
      console.error('[CorrectionHandler] Error:', e);
      return { success: false, error: "Grace, Rocky's memory is full. Try again later." };
    }
  }
}
