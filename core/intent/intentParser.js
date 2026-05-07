export default class IntentParser {
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

  async parse(input) {
    console.log(`[IntentParser] Parsing input: "${input}"`);
    const preOverride = this._ruleBasedOverride(input);
    if (preOverride) {
      preOverride.route = preOverride.actionable ? 'execution' : 'conversation';
      preOverride.rawInput = input;
      console.log(`[IntentParser] Rule Override: ${preOverride.goal} | Domain: ${preOverride.domain}`);
      return preOverride;
    }
    
    // Goal-Based Schema with Domain Constraint
    const schema = {
      type: "object",
      properties: {
        goal: { type: "string" },
        entities: { type: "object" },
        domain: { type: "string", enum: ["automation", "research", "conversation"] },
        confidence: { type: "number" },
        actionable: { type: "boolean" }
      },
      required: ["goal", "entities", "domain", "actionable"]
    };
    
    const prompt = `
      You are the Domain Classifier for Rocky. 
      Analyze the input: "${input}"
      
      CLASSIFICATION RULES:
      1. "automation" (actionable: true):
         - Technical: controlling software, system settings, or files.
      
      2. "research" (actionable: true):
         - Facts: questions about the world, people, or events.
      
      3. "conversation" (actionable: false):
         - Human: jokes, greetings, life advice, or EMOTIONS.
         - PERSONAL: Questions about the user ("Who is my...", "What is my...") or facts the user told you.
         - Goal: "chat"

      Output strictly:
      {
        "goal": "normalized_goal",
        "entities": { ... },
        "domain": "automation" | "research" | "conversation",
        "confidence": 0.95,
        "actionable": true | false
      }
    `;
    
    let result = await this.aiProvider.generateStructured(prompt, schema);
    
    const postOverride = this._ruleBasedOverride(input, result);
    if (postOverride) result = postOverride;

    // Strict contract enforcement
    if (!result || !result.goal) {
      console.warn('[IntentParser] AI failed to output valid goal, falling back.');
      result = { goal: 'chat', entities: {}, domain: 'conversation', confidence: 0.5, actionable: false };
    }

    result.route = result.actionable ? 'execution' : 'conversation';
    result.rawInput = input;
    
    console.log(`[IntentParser] Output: ${result.goal} | Entities: ${JSON.stringify(result.entities)}`);
    return result;
  }
}
