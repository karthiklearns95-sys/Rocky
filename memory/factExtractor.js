const DEBUG_MODE = process.env.NODE_ENV !== 'production';

/**
 * FactExtractor
 * Passively scans user input to extract meaningful, long-term personal facts.
 */
export async function extractFacts(input, aiProvider) {
  const lower = input.toLowerCase().trim();
  const isQuestion = lower.endsWith('?') || /^(who|what|when|where|why|how|can|do|does|did|is|are|will|would|should)\b/.test(lower);
  const isCommand = /^(open|launch|start|play|pause|click|type|write|search|take|move|calculate|volume|mute|tell)\b/.test(lower);
  const hasExplicitPersonalFact =
    /\b(my|i|i'm|i am|i love|i like|i prefer|remember that)\b/.test(lower) &&
    /\b(is|are|am|love|like|prefer|called|named)\b/.test(lower) &&
    !isQuestion;

  if (!hasExplicitPersonalFact || ((isQuestion || isCommand) && !hasExplicitPersonalFact)) {
    return { facts: [] };
  }

  const schema = {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Usually 'user', but can be another person's name" },
            relation: { type: "string", description: "The relationship, e.g., 'crush', 'brother', 'favorite color'" },
            object: { type: "string", description: "The entity or value, e.g., 'Mugdha', 'John', 'blue'" },
            confidence: { type: "number", description: "How sure we are this is a stable fact (0.0 to 1.0)" }
          },
          required: ["subject", "relation", "object", "confidence"]
        }
      }
    },
    required: ["facts"]
  };

  const prompt = `
    Analyze this user input: "${input}"
    
    Extract STRICTLY long-term personal facts, relationships, or preferences.
    
    EXAMPLES OF VALID FACTS:
    - "My crush is Mugdha" -> [{ subject: "user", relation: "crush", object: "Mugdha", confidence: 0.95 }]
    - "I prefer spotify for music" -> [{ subject: "user", relation: "preferred_music_app", object: "spotify", confidence: 0.90 }]
    
    IGNORE:
    - Questions, unless the user explicitly states a personal fact in the same sentence.
    - Commands ("open spotify", "volume up")
    - World facts, corrections about public figures, or current events.
    - Temporary states ("I'm hungry", "I'm going to the store")
    - Vague statements
    
    If no stable personal facts are found, return an empty array for 'facts'.
    Only return facts with confidence > 0.8.
  `;

  try {
    const result = await aiProvider.generateStructured(prompt, schema);
    
    // Validate output
    if (!result || !Array.isArray(result.facts)) {
      return { facts: [] };
    }

    // Filter out low confidence or poorly formatted facts
    const validFacts = result.facts.filter(f => 
      f.subject && f.relation && f.object && f.confidence > 0.8
    );

    if (DEBUG_MODE && validFacts.length > 0) {
      console.log(`[FactExtractor] Extracted Facts:`, validFacts);
    }

    return { facts: validFacts };
  } catch (err) {
    // Always surface extraction failures — not just in debug mode.
    // Silent failures here degrade LanceDB index quality without any signal.
    console.warn(`[FactExtractor] Failed to extract facts (input: "${input.substring(0, 60)}..."): ${err.message}`);
    return { facts: [] };
  }
}
