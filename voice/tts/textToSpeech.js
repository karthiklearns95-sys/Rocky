import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class TextToSpeech {
  constructor() {
    this.isSpeaking = false;
    this.piperPath = path.join(__dirname, '..', '..', 'bin', 'piper', 'piper.exe');
    this.modelPath = path.join(__dirname, '..', '..', 'bin', 'piper', 'en_US-lessac-medium.onnx');
    this.scratchDir = path.join(__dirname, '..', '..', 'scratch');
  }

  async speak(text) {
    if (!text || text.trim().length === 0) return;

    this.isSpeaking = true;
    
    try {
      const outWav = path.join(this.scratchDir, 'tts_output.wav');
      
      // Clean up text for TTS (remove brackets, code blocks, etc)
      let cleanText = text.replace(/\[.*?\]/g, '').replace(/<.*?>/g, '').replace(/```[\s\S]*?```/g, 'Code block omitted.').trim();
      if (!cleanText) return;

      console.log(`[TTS] Generating audio with Piper: "${cleanText.substring(0, 50)}..."`);
      
      // Call Piper to generate WAV
      await new Promise((resolve, reject) => {
        const piper = spawn(this.piperPath, [
          '--model', this.modelPath,
          '--output_file', outWav
        ]);

        piper.stdin.write(cleanText);
        piper.stdin.end();

        piper.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Piper exited with code ${code}`));
        });
        
        piper.on('error', reject);
      });

      // Play WAV using PowerShell natively
      console.log(`[TTS] Playing audio natively...`);
      await new Promise((resolve) => {
         const player = spawn('powershell', [
            '-c',
            `(New-Object System.Media.SoundPlayer '${outWav}').PlaySync()`
         ]);
         player.on('close', resolve);
         player.on('error', resolve); // Don't crash if playback fails
      });
      
    } catch (error) {
      console.error(`[TTS] Piper playback error:`, error.message);
    } finally {
      this.isSpeaking = false;
    }
  }
}
