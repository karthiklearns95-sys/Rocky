import { ipcMain } from 'electron';
import eventBus from '../services/eventBus.js';
import normalizeCommand from './normalizer.js';
import tts from '../tts/textToSpeech.js'; // Fallback for repeating

export default class SpeechProvider {
  constructor() {
    this.confidenceThreshold = 0.75;
    this.tts = new tts();
    this.setupListeners();
  }

  setupListeners() {
    // Assuming the renderer sends: ipcRenderer.send('speech-result', { text, confidence })
    ipcMain.on('speech-result', async (event, data) => {
      const { text, confidence } = data;
      console.log(`[STT] Received: "${text}" (Confidence: ${confidence})`);

      if (confidence < this.confidenceThreshold) {
        console.log('[STT] Confidence too low, asking user to repeat.');
        await this.tts.speak("Grace, I didn't catch that clearly. Please repeat.");
        return;
      }

      // Dynamically load aiProvider to avoid circular dependency
      const { default: brain } = await import('../core/index.js');
      const normalizedText = await normalizeCommand(text, brain.aiProvider);
      
      console.log(`[STT] Normalized: "${normalizedText}"`);
      
      // Send to main brain loop
      eventBus.emit('USER_INPUT', normalizedText);
    });
  }

  startListening() {
    // Tell the renderer to activate Web Speech API recognition
    eventBus.emit('STATE_CHANGE', 'listening');
    // The renderer listens to state-changed='listening' and starts its mic.
  }
}
