export default class TextToSpeech {
  constructor() {
    this.isSpeaking = false;
  }

  async speak(text) {
    console.log(`[TTS] Speaking delegated to Web Speech API in Renderer.`);
    return Promise.resolve();
  }
}
