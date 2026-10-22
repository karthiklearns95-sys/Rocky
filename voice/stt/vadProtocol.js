/**
 * The line protocol spoken by the native voice-activity process (windowsSpeech.ps1):
 *
 *   [READY]               microphone open, listening
 *   [HEARTBEAT]           still alive (every few seconds)
 *   [WAKE]                the recogniser heard something that looks like the wake word
 *   [STOP]                a stop word, act immediately
 *   [AUDIO] <file name>   one utterance recorded to this WAV file inside the output folder
 *                         (a bare ASCII name, never a path, so code pages cannot garble it)
 *   [DEVICE] <name>       which microphone it listens to (once, after [READY])
 *   [DEVICE_CHANGED] <name> Windows' default microphone changed; the process exits right after
 *   [ERROR] <code> <text> it cannot work (code `no_microphone` = no input device)
 */

export function parseVadLine(line) {
  const l = String(line).trim();
  if (l === '[READY]') return { type: 'ready' };
  if (l === '[HEARTBEAT]') return { type: 'heartbeat' };
  if (l === '[WAKE]') return { type: 'wake' };
  if (l === '[STOP]') return { type: 'stop' };
  if (l === '[DEVICE]' || l.startsWith('[DEVICE] ')) return { type: 'device', name: l.slice('[DEVICE]'.length).trim() };
  if (l === '[DEVICE_CHANGED]' || l.startsWith('[DEVICE_CHANGED] ')) return { type: 'deviceChanged', name: l.slice('[DEVICE_CHANGED]'.length).trim() };
  if (l.startsWith('[AUDIO]')) return { type: 'audio', path: l.slice('[AUDIO]'.length).trim() };
  if (l.startsWith('[ERROR]')) {
    const rest = l.slice('[ERROR]'.length).trim();
    const [code = 'unknown', ...msg] = rest.split(/\s+/);
    return { type: 'error', code, message: msg.join(' ') };
  }
  return { type: 'unknown', line: l };
}

/**
 * Chunks from a pipe do not end on line boundaries: "[AUDIO] C:\\tmp\\a" can arrive as
 * "[AUDIO] C:\\tm" + "p\\a.wav\n". Collect text and hand back only complete lines.
 */
export class LineBuffer {
  constructor() { this.rest = ''; }

  push(chunk) {
    this.rest += String(chunk);
    const parts = this.rest.split(/\r?\n/);
    this.rest = parts.pop();            // the unfinished tail
    return parts.map((p) => p.trim()).filter(Boolean);
  }
}
