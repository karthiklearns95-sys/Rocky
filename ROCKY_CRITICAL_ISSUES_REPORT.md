# Rocky Platform: Critical Issues & Technical Debt Report
*(A Brutally Honest Assessment of Current State)*

## 1. Process & Architecture Instability
- **Electron/Vite Concurrency Crashes:** The current dev environment is unstable. Running Vite and Electron concurrently frequently leads to harsh terminations (`exit code 3221225786` / `0xC000013A`). Graceful shutdown isn't properly handled, which risks leaving orphaned processes or locked files.
- **Monolithic Agent Loop:** `agentLoop.js` is incredibly bloated (1100+ lines). The LangGraph state machine handles everything from proactive task queuing to UI validation in a single file, making debugging state transitions and race conditions a nightmare.

## 2. Vision System & UI Detection Hacks
- **Clipboard-based Screenshots:** `visionHandler.js` captures the screen by sending a `PrintScreen` keystroke via PowerShell and reading the system clipboard (`[System.Windows.Forms.Clipboard]::GetImage()`). This completely nukes the user's clipboard history and will randomly fail if another process is using the clipboard.
- **Hardcoded Display Resolutions:** The LLaVA zoom-in retry loop hardcodes screen dimensions to `1920x1080` (`(xPercent / 1000) * 1920`). If Rocky runs on a 4K, 1440p, or ultra-wide monitor, the coordinate math breaks entirely, leading to wildly inaccurate clicks.
- **Brittle UI Validation:** The state checks in `agentLoop.js` evaluate success based on whether the UI changed post-action (`True Validation Failed: UI did not change`). This frequently triggers false-positive error loops if the UI changes too quickly, too slowly, or if there's a background animation (like a blinking cursor).

## 3. PowerShell Execution & String Escaping
- **Fragile Script Generation:** The execution layer relies heavily on dynamically generating and running temporary PowerShell scripts. Comments like *"force overwrite to fix old bugs"* (`ocrSearch.js`) and workarounds for `exec()` string escaping (`getActiveWindow.js`) highlight that the IPC bridge is currently held together by duct tape. It is highly vulnerable to injection or parsing failures.

## 4. Local Inference (Ollama) Bottlenecks
- **JSON Hallucinations:** We are asking quantized, local models (Llama 3/Mistral/LLaVA) to return strictly formatted JSON with exact screen coordinates. Because Ollama isn't strictly enforcing JSON grammars for vision right now, the models frequently hallucinate text or return malformed JSON, instantly breaking the execution pipeline.
- **Unacceptable Latency:** The `detectWithRetry` loop in `visionHandler.js` takes a full screenshot, runs a LLaVA inference, then potentially crops the image and runs a *second* LLaVA inference. On standard hardware, this translates to 10-30 seconds *per click*, which is completely unviable for real-time automation.

## 5. Memory & Fact Extraction Flakiness
- **Unreliable Extractor:** The `factExtractor.js` routinely fails to parse facts from the conversation stream. When the local LLM fails to format its extraction output correctly, the pipeline silently drops the context (`Failed to extract facts`). This leads to a degraded LanceDB vector index and "amnesia" during long-running sessions.

## 6. Window Positioning & Screen Coordinates
- **Multi-Monitor Math Failures:** The movement logic in `useRockyMovement.js` calculates target positions based on the primary window's inner bounds (`window.innerWidth` / `innerHeight`). This single-monitor assumption completely breaks on multi-monitor setups or when display scaling (DPI) differs between screens, causing the agent UI to clip off-screen or jump erratically.

## 7. Voice Input (STT) Inaccuracy & Latency
- **Whisper-Tiny Phonetic Errors:** The local speech-to-text implementation (`speechToText.js`) relies on `Xenova/whisper-tiny.en`. While lightweight, it is highly susceptible to background noise and struggles with accents, producing messy transcripts.
- **Over-engineered Normalization:** Because the raw STT output is so poor, the system forces transcripts through an "LLM Normalizer" (`normalizer.js`) to guess the user's intent and fix typos. This "band-aid" approach adds massive latency to voice commands, making verbal interaction feel extremely sluggish compared to cloud APIs.
- **Flaky PowerShell VAD:** Voice Activity Detection (VAD) is partially handed off to a native Windows script (`windowsSpeech.ps1`), which is fragile and often fails to manage microphone states cleanly.
