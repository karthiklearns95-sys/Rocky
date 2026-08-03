/**
 * LLM Normalizer — STT output repair.
 *
 * REDESIGNED: The old approach fired a full LLM inference on every voice command
 * to fix noisy whisper-tiny output, adding 500ms–3s of latency before anything
 * else in the pipeline could start. This was redundant because SemanticInterpreter
 * already does intent-level repair with context.
 *
 * New approach: expanded rule-based table covering the ~30 most common STT
 * misheard patterns. If none match, return the raw text — SemanticInterpreter
 * handles the rest. The aiProvider parameter is kept for API compatibility but
 * is no longer called.
 */

// Common STT mishearings: [regex pattern, corrected text]
const RULE_TABLE = [
  // System controls
  [/\b(volume\s*up|vol\s*up|louder)\b/i, 'volume up'],
  [/\b(volume\s*down|vol\s*down|quieter|lower\s*volume)\b/i, 'volume down'],
  [/\b(mute|unmute|silence)\b/i, 'mute'],
  [/\b(screenshot|screen\s*shot|capture\s*screen)\b/i, 'take a screenshot'],

  // App launches — common phonetic errors
  [/\b(opn?|ohpen?|opin)\s+(sp[ao]t[a-z]*|spof[a-z]*)\b/i, 'open spotify'],
  [/\b(opn?|ohpen?|opin)\s+(chr[ao][a-z]*|goggle\s*chrome)\b/i, 'open chrome'],
  [/\b(opn?|ohpen?|opin)\s+(what[a-z]*|wats[a-z]*|wats+ap)\b/i, 'open whatsapp'],
  [/\b(opn?|ohpen?|opin)\s+(note[a-z]*|nodpad|nowpad)\b/i, 'open notepad'],
  [/\b(opn?|ohpen?|opin)\s+(calc[a-z]*|calck|calcu[a-z]*)\b/i, 'open calculator'],
  [/\b(opn?|ohpen?|opin)\s+(vs\s*code|vscode|visual\s*studio)\b/i, 'open vscode'],
  [/\b(opn?|ohpen?|opin)\s+(slack|slak)\b/i, 'open slack'],

  // Media controls
  [/\b(paus[e]?|pos[e]?|pawse)\s*(music|song|it|this)?\b/i, 'pause'],
  [/\b(play|plea|pley)\s*(music|song|it|this)?\b/i, 'play'],
  [/\b(nex[t]?|naxt)\s*(song|track)?\b/i, 'next'],
  [/\b(prev(ious)?|pref?)\s*(song|track)?\b/i, 'previous'],
  [/\b(skip|skipp?)\b/i, 'next'],

  // Window management
  [/\b(close|clos|cls)\s*(this|the)?\s*(window|app|tab)?\b/i, 'close this window'],
  [/\b(move|mov)\s*(to\s*)?(top\s*left)\b/i, 'move to top left'],
  [/\b(move|mov)\s*(to\s*)?(top\s*right)\b/i, 'move to top right'],
  [/\b(move|mov)\s*(to\s*)?(bottom\s*left)\b/i, 'move to bottom left'],
  [/\b(move|mov)\s*(to\s*)?(bottom\s*right)\b/i, 'move to bottom right'],
  [/\b(move|mov)\s*(to\s*)?cent(er|re)\b/i, 'move to center'],
];

export default async function normalizeCommand(text, _aiProvider) {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  for (const [pattern, replacement] of RULE_TABLE) {
    if (pattern.test(trimmed)) {
      const normalized = trimmed.replace(pattern, replacement);
      console.log(`[Normalizer] Rule match: "${trimmed}" → "${normalized}"`);
      return normalized;
    }
  }

  // No rule matched — return raw text and let SemanticInterpreter handle repair
  return trimmed.toLowerCase();
}
