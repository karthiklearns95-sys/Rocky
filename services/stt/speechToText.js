import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import eventBus from '../services/eventBus.js';
import stateManager from '../services/stateManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the Windows Speech PowerShell script
const PS_SCRIPT = path.join(__dirname, 'windowsSpeech.ps1');

export default class SpeechToText {
  constructor() {
    this.isListening = false;
    this.pyProcess = null;
  }

  startListening() {
    if (this.isListening) return;
    this.isListening = true;
    console.log('[STT] Starting offline Windows Native STT engine...');

    this.pyProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT]);

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
          console.log(`[STT] Raw Command: "${command}"`);
          
          import('../core/index.js').then(({ default: brain }) => {
            import('./normalizer.js').then(({ default: normalizeCommand }) => {
              normalizeCommand(command, brain.aiProvider).then((normalizedText) => {
                console.log(`[STT] Normalized Command: "${normalizedText}"`);
                eventBus.emit('USER_INPUT', normalizedText);
              });
            });
          }).catch(err => {
            console.error('[STT] Error loading normalizer:', err);
            eventBus.emit('USER_INPUT', command);
          });
        } else if (line.startsWith('[ERROR]')) {
          console.error(`[STT] Engine error: ${line}`);
        }
      }
    });

    this.pyProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('Exception')) {
        console.error('[STT] PowerShell error:', msg.trim());
      }
    });

    this.pyProcess.on('close', (code) => {
      console.log(`[STT] Native engine exited with code ${code}`);
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
