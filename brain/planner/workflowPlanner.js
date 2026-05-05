const ALLOWED_TOOLS = [
  'open_resource',
  'waitForAppReady',
  'typeText',
  'mouseClick',
  'pressKey',
  'scroll',
  'locateUIElement',
  'analyze_ui',
  'calculate',
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
    if (!Array.isArray(steps)) return false;
    for (const step of steps) {
      if (!step.tool || !ALLOWED_TOOLS.includes(step.tool)) {
        console.error(`[WorkflowPlanner] Validation Failed: "${step.tool}" is not in ALLOWED_TOOLS`);
        throw new Error(`Planner hallucinated or used invalid tool: ${step.tool}`);
      }
    }
    return true;
  }

  async createPlan(goal, entities, history = [], attempt = 1, ragContext = "", uiMap = {}) {
    this.uiMap = uiMap;
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

    const validatedUIMapContext = Array.isArray(this.uiMap?.elements) && this.uiMap.elements.length > 0
      ? `
      Validated UI Map:
      ${JSON.stringify({
        app: this.uiMap.app,
        windowTitle: this.uiMap.windowTitle,
        bounds: this.uiMap.bounds,
        confidence: this.uiMap.confidence,
        elements: this.uiMap.elements
      })}
      `
      : `
      Validated UI Map: none.
      `;

    const prompt = `
      [SYSTEM]
      Your goal is to generate a JSON workflow for: ${goal}
      Available tools: ${ALLOWED_TOOLS.join(', ')}

      [CONTEXT]
      Entities: ${JSON.stringify(entities)}
      Relevant Memory:
      ${ragContext || 'none'}
      ${validatedUIMapContext}
      ${historyContext}

      [RULES]
      - Use ONLY the tools listed above.
      - NEVER use webSearch, open_browser, or email tools for local app tasks (Spotify, etc.).
      - Start with open_resource if the app is not active.
      - Always use waitForAppReady and focusWindow after open_resource.
      - Use calculate directly for pure math. Do not open Calculator unless the user explicitly asks to open it.
      - Every waitForAppReady and focusWindow step MUST include { "appName": "..." }.
      - Every open_resource step MUST include a concrete { "query": "..." }; never output placeholders like "<app_name>".
      - If the validated UI map contains the target element, prefer mouseClick with those exact x/y coordinates.
      - If the validated UI map does not contain the target element, call locateUIElement first, then mouseClick using $LAST_OUTPUT.x and $LAST_OUTPUT.y.
      - Use analyze_ui only when the task needs a broad live UI map; do not call analyze_ui when the validated UI map already has the needed element.
      - NEVER invent mouseClick coordinates. Coordinates must come from the validated UI map or locateUIElement output.
      - Output valid JSON only.

      [EXAMPLE]
      Input: "play believer on spotify"
      Output: {
        "steps": [
          { "tool": "open_resource", "input": { "query": "spotify" } },
          { "tool": "waitForAppReady", "input": { "appName": "spotify" } },
          { "tool": "focusWindow", "input": { "appName": "spotify" } },
          { "tool": "pressKey", "input": { "key": "^l" } },
          { "tool": "typeText", "input": { "text": "believer" } },
          { "tool": "pressKey", "input": { "key": "{ENTER}" } }
        ]
      }
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
