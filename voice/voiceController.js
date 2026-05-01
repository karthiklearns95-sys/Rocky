import SpeechToText from './stt/speechToText.js';
import TextToSpeech from './tts/textToSpeech.js';
import eventBus from '../controller/eventBus.js';
import stateManager from '../controller/stateManager.js';

class VoiceController {
  constructor() {
    this.stt = new SpeechToText();
    this.tts = new TextToSpeech();
    this.setupListeners();
  }

  setupListeners() {
    // When brain is done, we must speak
    eventBus.on('RESPONSE_READY', async (response) => {
      // The main controller index.js handles stateManager = 'speaking'
      await this.tts.speak(response);
    });
  }

  triggerListening() {
    stateManager.setState('listening');
    this.stt.startListening();
  }
}

const voiceController = new VoiceController();
export default voiceController;
