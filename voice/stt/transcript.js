/**
 * transcript - turn what Whisper heard into what Rocky should do about it.
 *
 *   ignore     nothing for Rocky (no wake word and he is not listening)
 *   interrupt  a short stop word ("stop", "wait"): abort what he is doing
 *   wake       the wake word; `command` holds anything said after it in the same breath
 *   command    a request (he was already listening: after the wake word or in a follow-up window)
 *
 * Pure: no events, no I/O.
 */

const STOP_WORDS = ['stop', 'cancel', 'wait', 'nevermind', 'never mind', 'halt'];

// Whisper hears "Rocky" many ways. Exact spellings first; one-letter slips are accepted for words
// that are not themselves English ("rocket" stays a rocket).
const WAKE_VARIANTS = ['rocky', 'rocki', 'rockie', 'rockey', 'roky', 'roki', 'rocké', 'rockee'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lower-case, drop sentence punctuation. */
export function cleanTranscript(text) {
  return String(text || '')
    // Whisper writes sounds that are not speech as notes: "(buzzing)", "[BLANK_AUDIO]", "*clicks*", "♪".
    .replace(/\([^)]*\)|\[[^\]]*\]|\*[^*]*\*|♪[^♪]*♪|[♪♫]/g, ' ')
    .trim().toLowerCase().replace(/[.,!?;:"]/g, '').replace(/\s+/g, ' ').trim();
}

function wakeRegex(wakeWord) {
  const variants = [...new Set([wakeWord, ...WAKE_VARIANTS])].map(escapeRe);
  return new RegExp(`\\b(?:hey\\s+|hi\\s+|okay\\s+|ok\\s+)?(?:${variants.join('|')})\\b`, 'g');
}

/**
 * @param {string} rawText what Whisper returned
 * @param {{ listening?: boolean, wakeWord?: string }} [opts] listening: Rocky is already waiting for a command
 * @returns {{ kind: 'ignore'|'interrupt'|'wake'|'command', text: string, command?: string }}
 */
export function interpretTranscript(rawText, { listening = false, wakeWord = 'rocky' } = {}) {
  const text = cleanTranscript(rawText);
  if (!text) return { kind: 'ignore', text };

  // Only a short, isolated stop word interrupts. "stop playing music" is a request, not an abort.
  const words = text.split(' ');
  if (words.length <= 2 && STOP_WORDS.some((w) => text === w || text.startsWith(`${w} `))) {
    return { kind: 'interrupt', text };
  }

  const re = wakeRegex(wakeWord);
  let last = null, m;
  while ((m = re.exec(text)) !== null) last = m;
  if (last) {
    const command = text.slice(last.index + last[0].length).replace(/^[\s,]+/, '').trim();
    return { kind: 'wake', text, command };
  }

  if (listening) return { kind: 'command', text };
  return { kind: 'ignore', text };
}
