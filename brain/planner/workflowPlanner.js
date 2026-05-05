const ALLOWED_TOOLS = [
  'open_resource',
  'waitForAppReady',
  'search_text',
  'typeText',
  'mouseClick',
  'pressKey',
  'scroll',
  'locateUIElement',
  'fetchAPI',
  'webSearch',
  'systemControl',
  'focusWindow'
];

export default class WorkflowPlanner {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  validateToolList(steps) {
    for (const step of steps) {
      if (!step.tool || !ALLOWED_TOOLS.includes(step.tool)) {
        throw new Error(`Planner hallucinated or used invalid tool: ${step.tool}`);
      }
    }
    return true;
  }

  async createPlan(goal, entities, history = [], attempt = 1) {
    console.log(`[WorkflowPlanner] Planning for goal: ${goal}`);

    const schema = {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool: { type: "string" },
              input: { type: "object" }
            },
            required: ["tool", "input"]
          }
        }
      },
      required: ["steps"]
    };

    const historyContext = history.length > 0
      ? `\nPREVIOUS ATTEMPT FAILED. Avoid repeating the same mistake. History:\n${JSON.stringify(history)}`
      : '';

    const prompt = `
      You are Rocky's workflow planner. 
      Generate a step-by-step generic workflow to accomplish the given GOAL.

      GOAL: ${goal}
      ENTITIES: ${JSON.stringify(entities)}
      ${historyContext}

      CRITICAL RULES:
      1. You MUST ONLY use the following generic tools: ${ALLOWED_TOOLS.join(', ')}
      2. You MUST NOT hallucinate tools (e.g., no "play_spotify", no "send_whatsapp").
      3. Always use "waitForAppReady" after "open_resource" before interacting with UI.
      4. Do not output any JSON schema boilerplate, ONLY the data.

      EXAMPLE - "open spotify and play believer":
      {
        "steps": [
          { "tool": "open_resource", "input": { "query": "spotify" } },
          { "tool": "waitForAppReady", "input": { "appName": "spotify" } },
          { "tool": "typeText", "input": { "text": "believer" } },
          { "tool": "pressKey", "input": { "key": "{ENTER}" } }
        ]
      }

      OUTPUT ONLY THE JSON.
    `;

    try {
      const result = await this.aiProvider.generateStructured(prompt, schema);
      
      let steps = [];
      // Heuristic extraction
      if (Array.isArray(result.steps)) steps = result.steps;
      else if (result.properties?.steps) steps = result.properties.steps;

      this.validateToolList(steps);
      return { steps };
    } catch (err) {
      console.error(`[WorkflowPlanner] Attempt ${attempt} failed:`, err.message);
      if (attempt < 3) {
        // Retry with stricter prompt
        return await this.createPlan(goal, entities, [{ error: err.message }], attempt + 1);
      }
      return { steps: [] };
    }
  }
}
