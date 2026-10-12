/**
 * App Configuration for Rocky
 */
const env = (typeof process !== 'undefined' && process.env) || {};

const config = {
  // Chrome Profiles
  defaultChromeProfile: "karthikeya kumara 3",

  // File System
  defaultSavePath: "Desktop", // Relative to USERPROFILE

  // Local models (Ollama). Tuned for a 6 GB GPU: one small multimodal model
  // serves chat, planning, fact extraction and vision so it stays loaded.
  // Override any of them with ROCKY_*_MODEL env vars; no code change needed.
  models: {
    brain: env.ROCKY_BRAIN_MODEL || 'gemma3:4b',
    vision: env.ROCKY_VISION_MODEL || env.ROCKY_BRAIN_MODEL || 'gemma3:4b',
    coder: env.ROCKY_CODER_MODEL || env.ROCKY_BRAIN_MODEL || 'gemma3:4b',
    reflection: env.ROCKY_REFLECTION_MODEL || env.ROCKY_BRAIN_MODEL || 'gemma3:4b',
    embedding: env.ROCKY_EMBED_MODEL || 'nomic-embed-text',
  },

  // Speech recognition (Whisper, runs on the CPU in a worker thread so it never blocks the app).
  // base.en is fast and clearly better than tiny.en; small.en is the most accurate but ~3x slower.
  // Override with ROCKY_STT_MODEL (e.g. Xenova/whisper-small.en). If the chosen model cannot be
  // loaded (first run offline, bad download) the next one in fallbackModels is tried.
  stt: {
    model: env.ROCKY_STT_MODEL || 'Xenova/whisper-base.en',
    fallbackModels: ['Xenova/whisper-tiny.en'],
    cacheDir: env.ROCKY_MODEL_CACHE || null,   // default: ~/.rocky/models
    wakeWord: 'rocky',
    minSpeechMs: 350,        // shorter clips are clicks and breaths, not commands
    minRms: 0.004,           // quieter than this is silence (0..1 scale)
    quietRms: 0.012,         // below this, a stock Whisper phrase ("thank you") is a hallucination
    maxQueue: 4,             // clips waiting for the recogniser; the oldest are dropped first
    maxClipAgeMs: 20000,     // a clip that waited longer than this is too stale to act on
    requestTimeoutMs: 45000, // one transcription must finish within this or the worker is restarted
  },

  // How long Ollama keeps the model in VRAM after a request.
  ollamaKeepAlive: env.ROCKY_KEEP_ALIVE || '30m',
};

export default config;
