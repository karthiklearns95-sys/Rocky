import eventBus from '../../controller/eventBus.js';

export default class SpeechToText {
  constructor() {
    this.isListening = false;
  }

  startListening() {
    this.isListening = true;
    console.log('[STT] Started listening...');
    
    // Mocking an audio input detection and conversion after 3 seconds
    setTimeout(() => {
      if (this.isListening) {
        const mockedUserInput = "Hello Rocky, what's my schedule today?";
        console.log(`[STT] Heard: "${mockedUserInput}"`);
        eventBus.emit('USER_INPUT', mockedUserInput);
        this.stopListening();
      }
    }, 3000);
  }

  stopListening() {
    this.isListening = false;
    console.log('[STT] Stopped listening.');
  }
}
