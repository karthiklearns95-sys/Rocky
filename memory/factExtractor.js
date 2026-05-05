const DEBUG_MODE = true;

/**
 * FactExtractor
 * Passively scans user input to extract meaningful, long-term personal facts.
 */
export async function extractFacts(input, aiProvider) {
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
    - Commands ("open spotify", "volume up")
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
    if (DEBUG_MODE) console.error(`[FactExtractor] Failed to extract facts:`, err.message);
    return { facts: [] };
  }
}
