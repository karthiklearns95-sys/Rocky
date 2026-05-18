import SpeechToText from '#voice/stt/speechToText.js';
import TextToSpeech from '#voice/tts/textToSpeech.js';
import eventBus from '#services/eventBus.js';
import stateManager from '#services/stateManager.js';

class VoiceController {
  constructor() {
    this.stt = new SpeechToText();
    this.tts = new TextToSpeech();
    this.setupListeners();
    // STT is started explicitly via start() after the controller is ready
  }

  start() {
    this.stt.startListening();
  }

  setupListeners() {
    // When brain is done, we must speak
    eventBus.on('RESPONSE_READY', async (response) => {
      await this.tts.speak(response);
    });
    
    // Kill the window instantly if a physical anomaly aborts execution
    eventBus.on('execution:abort', () => {
        if (this.isFollowUpWindowActive) {
            console.log(`[VoiceController] 🛑 Physical intervention detected. Snapping follow-up window shut.`);
            this.isFollowUpWindowActive = false;
            clearTimeout(this.followUpTimer);
            if (stateManager.getState() === 'listening') {
                stateManager.setState('idle');
            }
        }
    });
  }

  startFollowUpWindow(durationMs = 3000) {
      console.log(`[VoiceController] 🎤 Opening Intelligent Follow-Up Window (${durationMs}ms). Active listening...`);
      this.isFollowUpWindowActive = true;
      stateManager.setState('listening'); // Bypasses wake-word requirement
      
      if (this.followUpTimer) clearTimeout(this.followUpTimer);
      
      this.followUpTimer = setTimeout(() => {
          if (this.isFollowUpWindowActive) {
              console.log(`[VoiceController] 🛑 Follow-Up Window expired.`);
              this.isFollowUpWindowActive = false;
              if (stateManager.getState() === 'listening') {
                  stateManager.setState('idle');
              }
          }
      }, durationMs);
  }

  triggerListening() {
    stateManager.setState('listening');
    this.stt.startListening();
  }
}

const voiceController = new VoiceController();
export default voiceController;
