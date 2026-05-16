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
  'focusWindow',
  'browserOpen',
  'browserClick',
  'browserType',
  'browserRead',
  'desktopClick',
  'desktopType'
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
      - **CRITICAL**: For ANY task involving websites, YouTube, WhatsApp Web, Spotify Web, or browsing the internet, you MUST use the Playwright Browser tools (\`browserOpen\`, \`browserClick\`, \`browserType\`, \`browserRead\`).
      - \`browserOpen\` requires \`{ "url": "..." }\`.
      - \`browserClick\` requires \`{ "query": "..." }\` (semantic description of the element to click).
      - \`browserType\` requires \`{ "query": "...", "text": "...", "pressEnter": true/false }\`.
      - Do NOT use \`open_resource\` to open "chrome" if you are going to a website. Use \`browserOpen\` with the URL instead.
      - When using browser tools, use \`query\` to semantically describe the element (e.g. "Search bar", "Play button", "Send message"). DO NOT use x/y coordinates for browser tasks.
      - For local desktop apps (Notepad, Calculator, Word, File Explorer, etc), start with \`open_resource\` if the app is not active. Always use \`waitForAppReady\` and \`focusWindow\` after \`open_resource\`.
      - **CRITICAL**: For ALL desktop UI interactions (clicking buttons, typing into fields), you MUST use the UIA Native tools (\`desktopClick\`, \`desktopType\`).
      - When using \`desktopClick\` or \`desktopType\`, provide a \`query\` to semantically describe the element (e.g. "Save", "File", "Search"). DO NOT use \`mouseClick\` with x/y coordinates unless \`desktopClick\` explicitly fails.
      - Use \`analyze_ui\` ONLY when you need to "see" the app because the user asked you to describe it. Do not use it for simple button clicking.
      - Output valid JSON only.

      [EXAMPLE 1: Local App]
      Input: "play believer on spotify"
      Output: {
        "steps": [
          { "tool": "open_resource", "input": { "query": "spotify" } },
          { "tool": "waitForAppReady", "input": { "appName": "spotify" } },
          { "tool": "focusWindow", "input": { "appName": "spotify" } },
          { "tool": "desktopClick", "input": { "query": "Search" } },
          { "tool": "desktopType", "input": { "query": "Search bar", "text": "believer", "pressEnter": true } }
        ]
      }

      [EXAMPLE 2: Web Workflow]
      Input: "search youtube for coding tutorials"
      Output: {
        "steps": [
          { "tool": "browserOpen", "input": { "url": "youtube.com" } },
          { "tool": "browserType", "input": { "query": "search", "text": "coding tutorials", "pressEnter": true } },
          { "tool": "browserClick", "input": { "query": "video link" } }
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
