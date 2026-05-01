export default class TextToSpeech {
  constructor() {
    this.isSpeaking = false;
  }

  async speak(text) {
    console.log(`[TTS] Speaking: "${text}"`);
    this.isSpeaking = true;
    
    // Abstracted: In future, call ElevenLabs, OpenAI TTS, or Local Web Speech API
    return new Promise((resolve) => {
      // Simulate speaking time based on text length
      const duration = Math.min(Math.max(text.length * 50, 1000), 5000);
      setTimeout(() => {
        this.isSpeaking = false;
        console.log('[TTS] Finished speaking.');
        resolve();
      }, duration);
    });
  }
}
