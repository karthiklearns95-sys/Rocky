/**
 * Planner — Enforces strict JSON schema, sanitization, and tool contracts.
 */
const DEBUG_MODE = true;

function sanitizePlannerOutput(output) {
  if (DEBUG_MODE) console.log(`[Planner] Raw Output:`, JSON.stringify(output));
  
  if (!output || typeof output !== 'object') return { steps: [] };

  // Heuristic: If the model returned a schema-wrapped object, try to extract 'steps' from deep inside
  let steps = null;

  // Case 1: Standard { steps: [...] }
  if (Array.isArray(output.steps)) {
    steps = output.steps;
  } 
  // Case 2: Hallucinated schema-wrapped { properties: { steps: { items: [...] } } }
  else if (output.properties?.steps?.items && Array.isArray(output.properties.steps.items)) {
    steps = output.properties.steps.items;
  }
  // Case 3: Just { properties: { steps: [...] } }
  else if (output.properties?.steps && Array.isArray(output.properties.steps)) {
    steps = output.properties.steps;
  }
  // Case 4: Randomly wrapped anywhere else (recursively find first 'steps' array)
  else {
    const findSteps = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      if (Array.isArray(obj.steps)) return obj.steps;
      for (const key in obj) {
        const found = findSteps(obj[key]);
        if (found) return found;
      }
      return null;
    };
    steps = findSteps(output);
  }

  // Final validation and cleaning of individual step objects
  const cleanSteps = (steps || []).filter(s => s && typeof s === 'object' && s.tool && typeof s.tool === 'string');

  const clean = { steps: cleanSteps };
  if (DEBUG_MODE) console.log(`[Planner] Sanitized Output:`, JSON.stringify(clean));
  return clean;
}

export default class Planner {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  async createPlan(intentData, history = [], availableTools = "", constraint = null) {
    if (DEBUG_MODE) console.log(`[Planner] Creating plan for intent: ${intentData.intent}`);

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

    // Only surface tool name + success/fail — no content that could confuse the planner
    const historyContext = history.length > 0
      ? `Previous steps:\n${history.map((h, i) => `  ${i + 1}. tool="${h.tool || h.action}" result=${h.result?.success ? 'ok' : 'fail'} ${h.result?.error ? `(${h.result.error})` : ''}`).join('\n')}`
      : '';

    const constraintContext = constraint ? `\nCRITICAL OVERRIDE: ${constraint}` : '';

    const prompt = `
You are Rocky's execution planner. Your ONLY job is to output a list of tool steps to complete the user's CURRENT request.

Current Request: "${intentData.rawInput}"
Intent Type: ${intentData.intent}
App Target: ${intentData.appName || 'None'}
${historyContext}
${constraintContext}

RULE 1 — TOOLS: You MUST only use tools from this exact list:
[${availableTools || 'locateUIElement, mouseClick, typeText, pressKey, open_resource, webSearch, fetchAPI, systemControl, sendEmailDirect'}]

RULE 2 — FOCUS: Only plan steps to complete the CURRENT request. Do NOT act on memory, history content, or background knowledge unless it directly helps fulfill the current command.

RULE 3 — NO SCHEMA: DO NOT output any schema keywords (no "type", "properties", or "required"). This is critical.

RULE 4 — CHAIN: Use "$LAST_OUTPUT.fieldName" to pass data between steps.

TOOL FORMAT EXAMPLES (follow these exactly):
- Open app:      { "tool": "open_resource",    "input": { "query": "spotify" } }
- Send email:    { "tool": "sendEmailDirect",  "input": { "recipient": "a@b.com", "subject": "Hi", "body": "msg" } }
- Click element: { "tool": "mouseClick",       "input": { "x": "$LAST_OUTPUT.x", "y": "$LAST_OUTPUT.y" } }

OUTPUT ONLY THE DATA JSON (NO SCHEMA):
{
  "steps": [
    { "tool": "tool_name", "input": { "key": "value" } }
  ]
}
    `.trim();

    try {
      const result = await this.aiProvider.generateStructured(prompt, schema);
      return sanitizePlannerOutput(result);
    } catch (err) {
      if (DEBUG_MODE) console.error('[Planner] Failed to create plan:', err.message);
      return { steps: [] };
    }
  }
}

