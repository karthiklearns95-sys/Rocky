# Rocky: Advanced Local Autonomous AI Agent

## Overview
Rocky is a privacy-first autonomous AI agent platform designed for local desktop automation, deep contextual memory, and proactive intelligent assistance. Built entirely to run on local hardware without cloud API dependencies, Rocky ensures complete data privacy and true offline execution.

Rocky has evolved into a resilient, **multi-threaded, voice-enabled Chief of Staff** powered by a modular, fault-tolerant **Unified Agent Loop**.

---

## 🛡️ Production Hardening & System Stabilization (v2.0 Overhaul)
Following a comprehensive technical audit, Rocky's core runtime underwent a deep architectural stabilization to eliminate technical debt, silent failure modes, and process bottlenecks:

- **Non-Destructive Vision Pipeline:** Eliminated legacy clipboard-based screenshot hacks across OCR search, UI grounding, and LLaVA fallbacks. All visual capture now uses native `screenshot-desktop` and direct display framebuffer access (`CopyFromScreen`), ensuring user clipboard data is completely untouched and dynamic screen dimensions are queried at runtime.
- **Process Isolation & Anti-Hang Guardrails:** Integrated rigorous execution timeouts (`execWithTimeout`) across all PowerShell and OS subprocess invocations, preventing script freezes or UAC prompts from hanging the main application thread.
- **Modular Orchestration Architecture:** Decomposed the monolithic 1,200+ line `AgentLoop` into standalone, domain-driven coordinators:
  - `ClickResolver`: Manages visual coordinate resolution, UI element grounding, and LLaVA coordinate inference.
  - `UIMapCoordinator`: Handles live window snapshotting, UIA tree extraction, and cache validation.
  - `PlanUtils`: Isolates stateless helper utility functions for deterministic unit testing.
- **Non-Blocking Memory I/O & Graceful Fallbacks:** Converted synchronous disk I/O in `uiMapStore` to an instantaneous in-memory read cache backed by a non-blocking asynchronous write queue. Configured Neo4j database initialization with seamless graceful fallbacks when offline, allowing the loop to function smoothly without database dependency crashes.
- **Voice Pipeline Acceleration:** Removed redundant LLM normalization overhead from speech-to-text processing by implementing an expanded rule-based phonetic error correcting engine (~30 patterns), shaving up to 3 seconds off command latency while fixing operator precedence in semantic routing.
- **Security & Multi-Monitor Support:** Hardened PowerShell string interpolation against command injection (`openResource`) and resolved OS-to-renderer coordinate translation offsets across high-DPI and multi-monitor displays (`window.screenX/Y`).
- **Memory Optimization:** Bounded `actionCache` growth with an absolute size capacity limit and automatic time-to-live (TTL) eviction. Removed dead state machine dependencies (`xstate`).

---

## 🚀 The 5-Phase Architecture (Current State)

### Phase 1: The God Mode Loop (Initiative Engine)
Rocky does not wait to be spoken to. The **Initiative Engine** runs asynchronously in the background, utilizing scheduled screen-captures and a local Vision model (`llava`) to silently observe your desktop. If you are stuck on a complex spreadsheet or reading a long document, Rocky can proactively intervene and offer assistance out loud.

### Phase 2: The Semantic Router
To eliminate LLM latency for simple tasks, Rocky uses a **Fast-Path Semantic Router**. By analyzing incoming intents against a vector index, Rocky can completely bypass the LLM "thinking" phase for basic macros. Commands like *"Open Spotify"*, *"Mute the volume"*, or *"Take a screenshot"* execute instantly via direct OS-level integrations.

### Phase 3: The Tri-Database Memory System
Rocky possesses structured memory across three specialized local databases:
1. **LanceDB (Vector Database):** Stores semantic embeddings of past workflows, allowing Rocky to dynamically pull successful strategies from past automations.
2. **Neo4j (Knowledge Graph):** Extracts and stores relationship fact-triples (e.g., `[USER] -[LIKES]-> [COFFEE]`). Degrades gracefully when offline without impeding standard agent operations.
3. **SQLite (Relational Database):** Handles strict operational state tracking and system logs.

### Phase 4: Real-Time Voice (Local Audio Pipeline)
Rocky is fully conversational:
- **Hearing:** Uses a local offline **Whisper** model paired with Native Voice Activity Detection (VAD).
- **Speaking:** Uses a local **Piper TTS** model (`en_US-lessac-medium.onnx`) running natively through PowerShell for lightning-fast audio responses.
- **Conversational Orchestration:** Powered by a non-blocking internal finite state machine (`AgentLoop`), allowing Rocky to chat while simultaneously coordinating complex tasks.

### Phase 5: The Chief of Staff Delegation Framework
When asked to perform computational tasks (like *"Write a Python script that fetches Bitcoin prices"*), the supervisor instantly offloads the job to a **Headless Worker Node** running `Qwen2.5-Coder` in a separate `worker_thread`. Rocky replies immediately out loud, allowing conversation to continue while the background worker invisibly writes, validates, and executes the code via the `ToolManager`.

---

## ⚙️ Technology Stack
- **Inference:** Ollama (`mistral`, `llava`, `qwen2.5-coder`)
- **Orchestration:** Custom Multi-Threaded Finite State Machine (`AgentLoop`)
- **Frontend:** React, Vite, Electron IPC
- **Memory:** LanceDB, Neo4j, SQLite
- **Voice:** Whisper (STT), Piper (TTS)
- **Vision & GUI Automation:** Nut.js, WinRT UI Automation, Windows OCR, `screenshot-desktop`, Playwright

---

## 🔮 Future Development Roadmap
To transition Rocky from a hardened high-performance prototype into a fully robust production system capable of operating seamlessly across unknown environments, the next critical architectural milestones include:

1. **Dynamic App & Capability Discovery:** Replace hardcoded fast-path application registries with dynamic system capability scraping and start-menu enumeration.
2. **Structured LLM Output Enforcement:** Implement strictly typed JSON schema validation and structured retry loops (via grammar guidance in local inference servers) to guarantee zero formatting hallucinations during complex tool calls.
3. **Full Multi-Monitor Vision & OCR Capture:** Extend screenshotting and OCR grounding routines beyond `PrimaryScreen` to capture across virtual display bounding boxes.
4. **VAD Auto-Recovery & Process Resumption:** Integrate automatic watchdog restarts for the local PowerShell VAD process to recover transparently from Windows audio subsystem interruptions or sleep cycles.
5. **Playwright CDP Browser Integration:** Complete the implementation of Chrome DevTools Protocol (CDP) / DOM grounding to enable resilient web application interaction alongside native GUI automation.
6. **Cross-Platform Support:** Expand the Windows-focused PowerShell and UIA automation layers to provide seamless, native support for Linux and macOS environments.
