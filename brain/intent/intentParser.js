export default class IntentParser {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  async parse(input) {
    console.log(`[IntentParser] Parsing input: "${input}"`);
    
    // Goal-Based Schema
    const schema = {
      type: "object",
      properties: {
        goal: { type: "string" },
        entities: { type: "object" },
        confidence: { type: "number" },
        actionable: { type: "boolean" }
      },
      required: ["goal", "entities", "actionable"]
    };
    
    const prompt = `
      Extract the goal and entities from: "${input}"
      
      CRITICAL: Grace might make spelling mistakes. Use FUZZY MATCHING to deduce the real intent.
      
      GOALS:
      - "send_email": Requires "recipient" and "subject" / "body" if present.
      - "open_app": Requires "app" (normalized to lowercase, e.g. "spotify", "chrome", "notepad").
      - "play_media": Requires "app" and "query" (e.g. "believer").
      - "send_message": Requires "app" (e.g. "whatsapp"), "target", "content".
      - "system_control": Requires "action" (e.g. "volume up", "mute").
      - "take_screenshot": No entities needed.
      - "chat": Set actionable to FALSE.
      
      Output strictly:
      {
        "goal": "...",
        "entities": { ... },
        "confidence": 0.9,
        "actionable": true
      }
    `;
    
    let result = await this.aiProvider.generateStructured(prompt, schema);
    
    // Strict contract enforcement
    if (!result || !result.goal) {
      console.warn('[IntentParser] AI failed to output valid goal, falling back.');
      result = { goal: 'chat', entities: {}, confidence: 0.5, actionable: false };
    }

    result.route = result.actionable ? 'execution' : 'conversation';
    result.rawInput = input;
    
    console.log(`[IntentParser] Output: ${result.goal} | Entities: ${JSON.stringify(result.entities)}`);
    return result;
  }
}
