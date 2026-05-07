/**
 * LLM Normalizer - Uses local AI to cleanly translate noisy STT input into precise intent.
 */
export default async function normalizeCommand(text, aiProvider) {
  const normalizedText = text.toLowerCase().trim();
  
  // Fast-track known exact phrases to save latency
  if (normalizedText.includes('volume up')) return 'volume up';
  if (normalizedText.includes('volume down')) return 'volume down';
  if (normalizedText.includes('mute')) return 'mute';
  
  if (!aiProvider) return normalizedText;

  const prompt = `
    You are an STT (Speech-to-Text) correction engine. 
    The following input is a voice command that may contain phonetic mistakes, typos, or poor grammar from the microphone.
    Analyze the phonetics and context of the mistakes, and reconstruct the user's actual intended command.
    Convert it to a direct, actionable sentence.
    
    Examples:
    "opn yutb" -> "open youtube"
    "clik snd btn" -> "click send button"
    "shuw me th wrather" -> "show me the weather"
    
    Command: "${text}"
    
    Respond ONLY with the corrected command string, nothing else.
  `;

  try {
    const result = await aiProvider.generate(prompt, { skipFormat: true });
    return result ? result.trim().toLowerCase() : normalizedText;
  } catch (e) {
    console.error('[Normalizer] LLM failed, using raw text.', e);
    return normalizedText;
  }
}
