import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import eventBus from '../../controller/eventBus.js';
import stateManager from '../../controller/stateManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the Python venv interpreter and the STT script
const PYTHON_BIN = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
const STT_SCRIPT = path.join(__dirname, 'stt_engine.py');

export default class SpeechToText {
  constructor() {
    this.isListening = false;
    this.pyProcess = null;
  }

  startListening() {
    if (this.isListening) return;
    this.isListening = true;
    console.log('[STT] Starting offline Python/Vosk STT engine...');

    this.pyProcess = spawn(PYTHON_BIN, [STT_SCRIPT]);

    this.pyProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line === '[READY]') {
          console.log('[STT] Vosk engine ready. Say "Rocky".');
        } else if (line === '[WAKE]') {
          console.log('[STT] Wake word detected!');
          stateManager.setState('listening');
        } else if (line.startsWith('[COMMAND]')) {
          const command = line.replace('[COMMAND]', '').trim();
          console.log(`[STT] Command: "${command}"`);
          eventBus.emit('USER_INPUT', command);
        } else if (line.startsWith('[ERROR]')) {
          console.error(`[STT] Engine error: ${line}`);
        }
      }
    });

    this.pyProcess.stderr.on('data', (data) => {
      // Vosk prints info logs to stderr - only log real errors
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('Traceback')) {
        console.error('[STT] Python error:', msg.trim());
      }
    });

    this.pyProcess.on('close', (code) => {
      console.log(`[STT] Python engine exited with code ${code}`);
      this.isListening = false;
    });
  }

  stopListening() {
    this.isListening = false;
    if (this.pyProcess) {
      this.pyProcess.kill();
      this.pyProcess = null;
    }
    console.log('[STT] Engine stopped.');
  }
}
