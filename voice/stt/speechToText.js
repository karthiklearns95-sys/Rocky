import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import wavefilePkg from 'wavefile';
const { WaveFile } = wavefilePkg;
import { pipeline, env } from '@xenova/transformers';
import eventBus from '#services/eventBus.js';
import stateManager from '#services/stateManager.js';

// Optimize transformers
env.allowLocalModels = false;
env.useBrowserCache = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PS_SCRIPT = path.join(__dirname, 'windowsSpeech.ps1');

export default class SpeechToText {
  constructor() {
    this.isListening = false;
    this.transcriber = null;
    this.pyProcess = null;
    this.initModel();
  }

  async initModel() {
    console.log('[STT] Loading local Whisper model...');
    try {
      this.transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
      console.log('[STT] Whisper engine loaded. Ready to transcribe.');
    } catch (e) {
      console.error('[STT] Failed to load Whisper model:', e);
    }
  }

  async processAudioFile(wavPath) {
    if (!this.transcriber || !this.isListening) return;

    try {
      if (!fs.existsSync(wavPath)) return;
      
      const buffer = fs.readFileSync(wavPath);
      const wav = new WaveFile(buffer);
      wav.toSampleRate(16000); // Whisper expects 16kHz
      
      let samples = wav.getSamples(false, Float32Array);
      // Handle stereo
      if (Array.isArray(samples)) samples = samples[0];
      
      const result = await this.transcriber(samples, {
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      
      let text = result.text.trim().toLowerCase();
      text = text.replace(/[.,!?]/g, '').trim();
      
      if (!text) return;
      console.log(`[STT] Whisper recognized: "${text}"`);
      
      // Interruptibility check (Strictly Contextual to avoid false positives)
      const stopWords = ['stop', 'cancel', 'wait', 'nevermind', 'never mind', 'halt'];
      const wordCount = text.split(' ').length;
      
      // Only abort if it's a short isolated command (e.g. "stop", "wait!"). 
      // Do NOT abort if it's a command like "stop playing music" or "wait for the email".
      if (wordCount <= 2 && stopWords.some(w => text === w || text.startsWith(w + " "))) {
         console.log(`[STT] 🛑 Contextual Interrupt triggered by: "${text}"`);
         eventBus.emit('ABORT_EXECUTION');
         stateManager.setState('idle');
         return;
      }

      const isWakeWord = text.includes('rocky') || text.includes('hey rocky');
      
      if (isWakeWord) {
        stateManager.setState('listening');
        const parts = text.split(/rocky/);
        const remainder = (parts[parts.length - 1] || '').trim();
        
        if (remainder.length > 0) {
          eventBus.emit('USER_INPUT', remainder);
        }
      } else if (stateManager.getState() === 'listening') {
        eventBus.emit('USER_INPUT', text);
        stateManager.setState('idle');
      }

    } catch (e) {
      console.error('[STT] Inference error:', e);
    } finally {
      // Clean up temp audio file
      try {
        if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
      } catch (e) {}
    }
  }

  startListening() {
    if (this.isListening) return;
    this.isListening = true;
    console.log('[STT] Starting offline Native VAD engine...');

    this.pyProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT]);

    this.pyProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line === '[READY]') {
          console.log('[STT] Native VAD ready. Say "Rocky".');
        } else if (line === '[WAKE]') {
          console.log('[STT] Wake word detected by VAD!');
          stateManager.setState('listening');
        } else if (line === '[STOP]') {
          console.log(`[STT] 🛑 Native VAD triggered STOP!`);
          eventBus.emit('ABORT_EXECUTION');
          stateManager.setState('idle');
        } else if (line.startsWith('[AUDIO]')) {
          const wavPath = line.replace('[AUDIO]', '').trim();
          this.processAudioFile(wavPath);
        }
      }
    });

    this.pyProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('Exception')) {
        console.error('[STT] VAD error:', msg.trim());
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
