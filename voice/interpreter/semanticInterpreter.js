import { getSessionContext, updateSessionContext } from '#memory/sessionMemory.js';

/**
 * SemanticInterpreter
 * 
 * Transforms messy STT (Speech-to-Text) input into a structured semantic intent,
 * resolving conversational ambiguity, vague instructions, and contextual pronouns.
 * Unifies Intent Parsing and Semantic routing into a single, high-speed LLM pass.
 */
export class SemanticInterpreter {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  _extractKnownApp(input) {
    const lower = input.toLowerCase();
    const knownApps = ['spotify', 'notepad', 'calculator', 'chrome', 'edge', 'slack', 'whatsapp', 'vscode'];
    return knownApps.find((app) => lower.includes(app)) || null;
  }

  _ruleBasedOverride(input, parsed = null) {
    const lower = input.toLowerCase().trim();
    const app = this._extractKnownApp(lower);

    const personalMemoryQuestion =
      /\b(what|who|when|where|why|how)\s+(do\s+you\s+)?(remember|know)\s+(about\s+)?me\b/.test(lower) ||
      /\b(who|what|when|where|why|how)\s+(is|are|was|were|do|does|did|can|will|would|should)\s+my\b/.test(lower) ||
      /\bmy\s+(crush|favorite|favourite|name|birthday|preference|memory|fact)\b/.test(lower) && lower.includes('?');

    // Identity/self-referential — MUST never go to automation
    const selfReferential =
      /^(hi|hey|hello)\b/.test(lower) ||
      /\bwho\s+are\s+you\b/.test(lower) ||
      /\bwhat\s+(are|is)\s+you\b/.test(lower) ||
      /\bidentify.*(yourself|self)\b/.test(lower) ||
      /\bintroduce\s+yourself\b/.test(lower) ||
      parsed?.goal === 'identify_self' ||
      parsed?.goal === 'self_intro';

    if (selfReferential) {
      return {
        goal: 'chat',
        entities: parsed?.entities || {},
        domain: 'conversation',
        confidence: 1,
        actionable: false
      };
    }

    if (personalMemoryQuestion) {
      return {
        goal: 'recall_personal_memory',
        entities: parsed?.entities || {},
        domain: 'conversation',
        confidence: 1,
        actionable: false
      };
    }

    const explicitDesktopAction =
      /\b(open|launch|start|focus|click|type|write|search|play|pause|close|move)\b/.test(lower) &&
      (app || /\b(window|app|file|folder|screen|mouse|keyboard|volume|screenshot)\b/.test(lower));

    if (explicitDesktopAction) {
      return {
        ...parsed,
        goal: parsed?.goal || 'desktop_automation',
        entities: {
          ...(parsed?.entities || {}),
          ...(app ? { app } : {})
        },
        domain: 'automation',
        confidence: Math.max(parsed?.confidence || 0, 0.9),
        actionable: true
      };
    }

    return null;
  }

  /**
   * Cleans up STT text and infers full intent/domain using conversational context.
   * @param {string} sttText - Raw voice input (e.g., "opn spofity and ply beliver")
   * @param {string} ragContext - Optional retrieved knowledge
   * @returns {Promise<Object>} The unified intent schema.
   */
  async interpret(sttText, ragContext = '') {
    console.log(`[SemanticInterpreter] Processing input: "${sttText}"`);
    
    // 1. Check for immediate rule-based overrides (fastest path)
    const preOverride = this._ruleBasedOverride(sttText);
    if (preOverride) {
      preOverride.route = preOverride.actionable ? 'execution' : 'conversation';
      preOverride.rawInput = sttText;
      console.log(`[SemanticInterpreter] Rule Override: ${preOverride.goal} | Domain: ${preOverride.domain}`);
      return preOverride;
    }

    const context = getSessionContext();
    
    const prompt = `You are the Unified Semantic Interpreter & Domain Classifier for Rocky.
Your goal is to transform messy, vague, or fragmented speech into a clear semantic intent JSON.

CURRENT CONVERSATIONAL CONTEXT:
- Last App: ${context.lastApp || 'None'}
- Last Person/Target: ${context.lastTarget || 'None'}
- Last Action: ${context.lastAction || 'None'}
- Last UI Reference: ${context.lastUIReference || 'None'}

RELEVANT RETRIEVED KNOWLEDGE:
${ragContext || 'None'}

RULES:
1. Repair broken spelling and grammar (e.g. "opn spofity" -> "open spotify").
2. Resolve pronouns ("him" -> last target, "it" -> last app/action).
3. Extract spatial references if present ("near chrome", "bottom left").
4. Assign a domain:
   - "automation": Technical actions, controlling software, settings, media, files (actionable: true).
   - "research": Questions about the public world/facts NOT found in retrieved knowledge (actionable: true).
   - "conversation": Human chat, jokes, emotions, or ANY personal facts found in retrieved knowledge (actionable: false).

INPUT SPEECH: "${sttText}"

RETURN ONLY JSON FORMAT:
{
  "goal": "standardized_action_name_or_chat",
  "entities": {
    "app": "resolved app name or null",
    "target": "resolved person/entity or null",
    "content": "message or query content or null",
    "spatial_reference": "spatial phrase or null",
    "ui_element": "name of button/icon or null"
  },
  "domain": "automation" | "research" | "conversation",
  "confidence": 0.0,
  "actionable": true | false
}`;

    try {
      const schema = {
        type: "object",
        properties: {
          goal: { type: "string" },
          entities: {
            type: "object",
            properties: {
              app: { type: "string" },
              target: { type: "string" },
              content: { type: "string" },
              spatial_reference: { type: "string" },
              ui_element: { type: "string" }
            }
          },
          domain: { type: "string", enum: ["automation", "research", "conversation"] },
          confidence: { type: "number" },
          actionable: { type: "boolean" }
        },
        required: ["goal", "entities", "domain", "confidence", "actionable"]
      };
      
      let response = await this.aiProvider.generateStructured(prompt, schema);
      
      const postOverride = this._ruleBasedOverride(sttText, response);
      if (postOverride) response = postOverride;

      // Strict contract enforcement
      if (!response || !response.goal) {
        console.warn('[SemanticInterpreter] AI failed to output valid goal, falling back.');
        response = { goal: 'chat', entities: {}, domain: 'conversation', confidence: 0.5, actionable: false };
      }

      response.route = response.actionable ? 'execution' : 'conversation';
      response.rawInput = sttText;
      
      // Update session context if confidence is high enough
      if (response.confidence > 0.6) {
        updateSessionContext({
          lastApp: response.entities?.app || context.lastApp,
          lastTarget: response.entities?.target || context.lastTarget,
          lastAction: response.goal || context.lastAction
        });
      }
      
      console.log(`[SemanticInterpreter] Output: ${response.goal} | Domain: ${response.domain} | Entities: ${JSON.stringify(response.entities)}`);
      return response;
    } catch (error) {
      console.error('[SemanticInterpreter] Error inferring intent:', error);
      return {
        goal: 'chat',
        entities: {},
        domain: 'conversation',
        confidence: 0.0,
        actionable: false,
        route: 'conversation',
        rawInput: sttText
      };
    }
  }
}
