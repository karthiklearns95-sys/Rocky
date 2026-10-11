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

  // How long Ollama keeps the model in VRAM after a request.
  ollamaKeepAlive: env.ROCKY_KEEP_ALIVE || '30m',
};

export default config;
