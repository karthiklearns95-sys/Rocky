/**
 * Planner — Now receives clean intentData (FIX 4) and lean prompt (FIX 5).
 * No brand-name examples. No raw input passed in.
 */
export default class Planner {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  /**
   * Creates a plan from clean intent data.
   * FIX 4: uses intentData.intent/appName/query — NOT rawInput
   * FIX 5: lean prompt, no biasing examples
   */
  async createPlan(intentData) {
    console.log(`[Planner] Creating plan for intent: ${intentData.intent}`);

    const schema = {
      type: "object",
      properties: {
        plan: { type: "array", items: { type: "string" } },
        toolCalls: {
          type: "array",
          items: {
            type: "object",
            properties: {
              toolName: { type: "string" },
              args: { type: "object" }
            }
          }
        }
      }
    };

    // Build a lean, context-aware prompt from intent data (FIX 5 - no brand examples)
    const intentSummary = [
      intentData.intent && `Intent: ${intentData.intent}`,
      intentData.appName && `App: ${intentData.appName}`,
      intentData.profile && `Profile: ${intentData.profile}`,
      intentData.rawInput && `User said: "${intentData.rawInput}"`
    ].filter(Boolean).join('\n');

    const prompt = `
You are Rocky's action planner. Select the correct tool(s) to fulfill this request.

${intentSummary}

AVAILABLE TOOLS (use EXACT tool names):
- openApp(appName): Launch any desktop app by name.
- openChromeProfile(profileName): Open Chrome with a user profile.
- createFileWithContent(fileName, content): Create and open a file on the Desktop. Use {{step_0_result}} if content depends on a prior step.
- openFile(fileName): Open an existing file on the Desktop.
- takeScreenshot(): Capture the screen.
- systemControl(action): action is one of: "volume_up", "volume_down", "mute".
- webSearch(query): Search the internet for information.
- runCommand(command): Run a shell command on the Desktop.
- sendEmail(recipient, subject, body): Open a mailto email draft.

RULES:
- If the user is ONLY chatting (greeting, question, opinion), return toolCalls: [].
- ONLY call a tool if the user explicitly requests an action.
- For multi-step tasks, use {{step_N_result}} as a placeholder in later steps when they depend on earlier step output.
- Use only tools from the list above.

OUTPUT JSON:
{
  "plan": ["brief step description"],
  "toolCalls": [
    { "toolName": "exact_tool_name", "args": { "key": "value" } }
  ]
}
    `.trim();

    try {
      const result = await this.aiProvider.generateStructured(prompt, schema);
      return result || { plan: [], toolCalls: [] };
    } catch (err) {
      console.error('[Planner] Failed to create plan:', err.message);
      return { plan: [], toolCalls: [] };
    }
  }
}
