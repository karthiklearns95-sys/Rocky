const DEBUG_MODE = process.env.NODE_ENV !== 'production';

const MIN_CONFIDENCE = 0.7;

/**
 * Cheap pre-filter so the LLM is only called when the utterance could contain
 * something worth remembering. Returns true for statements about the user, the
 * people and things in their life, habits, shared events, ended facts, and
 * the user's own words for things. Pure commands and plain questions are skipped.
 */
export function shouldExtract(input) {
  const lower = String(input || '').toLowerCase().trim();
  if (!lower) return false;

  const isQuestion = lower.endsWith('?') ||
    /^(who|what|when|where|why|how|can|could|do|does|did|is|are|will|would|should)\b/.test(lower);
  const isCommand = /^(open|launch|start|play|pause|click|type|write|search|take|move|calculate|volume|mute|tell|show|close|scroll|press)\b/.test(lower);

  const personal = /\b(my|i|i'm|i am|i've|i'd|me|we|we're|our|remember that)\b/.test(lower) &&
    /\b(is|are|am|was|were|called|named|usually|always|never|every|(?:love|like|hate|prefer|work|live|study|finish|fix|start|stop|get|go|meet|plan|want|have|own|play|drive|use)(?:s|es|d|ed)?|finished|fixed|started|stopped|got|went|met)\b/.test(lower);
  const endedFact = /\b(no longer|not anymore|anymore|used to|stopped|quit|don't .* anymore)\b/.test(lower);
  const ownWords = /\b(call|calls|called|means?|refer to|when i say)\b/.test(lower) && /\b(my|i|me)\b/.test(lower);

  // "when I say X I mean Y" starts like a question but is a statement.
  if (ownWords || endedFact) return !lower.endsWith('?');
  return personal && !isQuestion && !isCommand;
}

const SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: "'user' for the speaker, or another person's name" },
          relation: { type: 'string', description: "e.g. 'brother', 'likes', 'works_at', 'favorite_color', 'finished'" },
          object: { type: 'string', description: "the entity or value, e.g. 'John', 'jazz', 'blue'" },
          subject_type: { type: 'string', enum: ['person', 'place', 'thing', 'activity', 'event', 'other'] },
          object_type: { type: 'string', enum: ['person', 'place', 'thing', 'activity', 'event', 'other'] },
          ended: { type: 'boolean', description: 'true if the user says this is NO LONGER true' },
          confidence: { type: 'number', description: 'How sure this is a stable fact (0.0 to 1.0)' }
        },
        required: ['subject', 'relation', 'object', 'confidence']
      }
    },
    aliases: {
      type: 'array',
      description: "The user's own words for something, e.g. 'my jams' = 'Chill Mix'",
      items: {
        type: 'object',
        properties: {
          alias: { type: 'string' },
          refers_to: { type: 'string' }
        },
        required: ['alias', 'refers_to']
      }
    }
  },
  required: ['facts']
};

/**
 * Clean the model's reply: drop malformed or low-confidence items and split
 * "no longer true" facts from new ones.
 */
export function normalizeExtraction(result) {
  const empty = { facts: [], retired: [], aliases: [] };
  if (!result || !Array.isArray(result.facts)) return empty;

  const usable = result.facts.filter(f =>
    f && f.subject && f.relation && f.object && Number(f.confidence) >= MIN_CONFIDENCE
  );
  const aliases = (Array.isArray(result.aliases) ? result.aliases : [])
    .filter(a => a && a.alias && a.refers_to);

  return {
    facts: usable.filter(f => !f.ended),
    retired: usable.filter(f => f.ended),
    aliases,
  };
}

/**
 * FactExtractor
 * Passively scans user input for long-term facts about the user's world:
 * people and relationships, preferences, habits, shared events, things that
 * stopped being true, and the user's own words for things.
 *
 * Returns { facts, retired, aliases } - always, even on failure.
 */
export async function extractFacts(input, aiProvider) {
  if (!shouldExtract(input)) return { facts: [], retired: [], aliases: [] };

  const prompt = `
Analyze this user input: "${input}"

Extract LONG-TERM facts about the speaker's world as (subject, relation, object) triples.
Use subject "user" for the speaker.

Capture:
- People and relationships: "my brother John" -> user / brother / John
- Facts about those people: "John's wife is Priya" -> John / wife / Priya
- Preferences and habits: "I usually code at night" -> user / usually_codes_at / night
- Shared events worth remembering: "we finally fixed the login bug" -> user / fixed / login bug
- Things that STOPPED being true: "I don't drink coffee anymore" -> user / drinks / coffee with ended=true
- The user's own words for things: "when I say my jams I mean the Chill Mix playlist" -> aliases: alias "my jams", refers_to "Chill Mix"

Ignore: questions, one-off commands, world facts, passing moods ("I'm hungry"), and vague statements.
If nothing qualifies, return empty arrays. Only include facts with confidence >= ${MIN_CONFIDENCE}.
`;

  try {
    const result = normalizeExtraction(await aiProvider.generateStructured(prompt, SCHEMA));
    if (DEBUG_MODE && (result.facts.length || result.retired.length || result.aliases.length)) {
      console.log('[FactExtractor] Extracted:', result);
    }
    return result;
  } catch (err) {
    // Always surface extraction failures; silent drops hide memory loss.
    console.warn(`[FactExtractor] Failed to extract facts (input: "${String(input).substring(0, 60)}..."): ${err.message}`);
    return { facts: [], retired: [], aliases: [] };
  }
}
