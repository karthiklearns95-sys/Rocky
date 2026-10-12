/**
 * audioGate - decide whether a recorded clip is worth sending to Whisper, and whether what came
 * back is real speech.
 *
 * Whisper never answers "nothing": given silence, a click or a breath it invents text, usually a
 * stock phrase ("Thank you.", "Thanks for watching", "[BLANK_AUDIO]"). Acting on that would make
 * Rocky obey a command nobody spoke, so clips are checked before and text after.
 */

/** Level and length of a clip: { durationMs, rms, peak } (rms/peak on a 0..1 scale). */
export function analyzeSamples(samples, sampleRate = 16000) {
  const n = samples?.length || 0;
  if (n === 0) return { durationMs: 0, rms: 0, peak: 0 };
  let sum = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i];
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  return { durationMs: Math.round((n / sampleRate) * 1000), rms: Math.sqrt(sum / n), peak };
}

/** Too short or too quiet to be speech? Returns { ok, reason }. */
export function shouldTranscribe(stats, { minSpeechMs = 350, minRms = 0.004 } = {}) {
  if (stats.durationMs < minSpeechMs) return { ok: false, reason: `too short (${stats.durationMs} ms)` };
  if (stats.rms < minRms) return { ok: false, reason: `too quiet (rms ${stats.rms.toFixed(4)})` };
  return { ok: true, reason: '' };
}

// Stock phrases Whisper emits for silence / noise. Real people say some of these too ("thank you"),
// so those are only discarded when the clip was quiet.
const QUIET_ONLY_HALLUCINATIONS = new Set([
  'you', 'thank you', 'thanks', 'thanks for watching', 'thank you for watching', 'bye', 'bye bye', 'the end',
  'please subscribe', 'subtitles by the amaraorg community', 'so', 'uh', 'um', 'hmm', 'oh',
]);

/** Non-speech markers Whisper writes in brackets/parentheses/notes: never a command. */
const MARKER = /^[\s\[\(♪*]*[a-z _-]*(blank_audio|silence|music|noise|inaudible|applause|laughter|sighs?)[a-z _-]*[\s\]\)♪*]*$/i;

/**
 * Is this transcript a hallucination rather than speech?
 * @param {string} text cleaned transcript
 * @param {{rms:number}} stats of the clip it came from
 */
export function isHallucination(text, stats, { quietRms = 0.012 } = {}) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (MARKER.test(t) || /^[\s.♪*\-–—…]+$/.test(t)) return true;
  const plain = t.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();
  if (!plain) return true;
  if (QUIET_ONLY_HALLUCINATIONS.has(plain) && stats && stats.rms < quietRms) return true;
  // The same word over and over ("you you you you") is the classic runaway on noise.
  const words = plain.split(' ');
  if (words.length >= 4 && new Set(words).size === 1) return true;
  return false;
}
