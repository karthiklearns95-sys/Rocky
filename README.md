# Rocky: Advanced Local Autonomous AI Agent

> **⚠️ Notice:** Rocky is currently in **active development**. Features, APIs, and overall system architecture are continuously evolving as we progress through our development roadmap.

## Overview
Rocky is a privacy-first autonomous AI agent platform designed for local desktop automation, deep contextual memory, and proactive intelligent assistance. Built entirely to run on local hardware without cloud API dependencies, Rocky ensures complete data privacy and true offline execution.

Rocky is a resilient, **multi-threaded, voice-enabled Chief of Staff** powered by a modular, fault-tolerant **Unified Agent Loop**. It sees the screen, hears voice commands, understands UI layouts, and physically executes mouse and keyboard actions across **any** Windows application.

---

## 🏗️ Architecture Overview

Rocky's architecture is a strict, contract-enforced pipeline organized into 7 core layers:

```
Voice / Text Input
       ↓
SemanticInterpreter  (LLM intent classification)
       ↓
ConversationalSupervisor  (route: conversation | execution)
       ↓
AgentLoop State Machine  (PLAN → EXECUTE → VALIDATE → RECOVER → COMPLETE)
  ├── SemanticRouter     (L0: LanceDB vector fast-path)
  ├── WorkflowCache      (L1: Deterministic plan cache)
  ├── WorkflowPlanner    (L2: LLM full plan generation)
  ├── ClickResolver      (Hybrid UIA + LLaVA vision)
  ├── UIMapCoordinator   (Live window snapshotting)
  ├── DelegationManager  (Background worker threads)
  └── InitiativeEngine   (Proactive OS observer)
       ↓
ToolManager  (28 registered tools)
       ↓
OS / System Execution
```

---

## 🚀 The 6-Phase Architecture (Current State)

### Phase 1: Tri-Layer Intent Routing (L0 / L1 / L2)
Rocky employs a **3-tier routing hierarchy** to minimize LLM latency:

1. **L0 — Fast-Path Handler (`_fastIntentHandler`):** Pure regex/rule-based matching for zero-latency commands (volume up/down, mute, screenshot, media keys, window close, Rocky movement commands). No LLM involved.
2. **L0.5 — Semantic Router (LanceDB Vector Search):** Embeds the user's utterance and performs a cosine-similarity search against a seeded cluster of deterministic intent → plan mappings. If distance < 0.50, a pre-built plan is executed immediately without touching the LLM Planner.
3. **L1 — Workflow Cache:** Checks SQLite/in-memory cache for a previously successful plan matching the current intent + entity signature.
4. **L2 — LLM Workflow Planner:** Full structured JSON plan generation via the AI provider when all faster tiers miss.

### Phase 2: The Modular State Machine (AgentLoop)
Rocky's orchestrator is a **5-state finite machine** (`PLAN → EXECUTE → VALIDATE → RECOVER → COMPLETE`) with a hard cap of 60 steps and 2 retries per step. The loop is decomposed into three standalone domain coordinators:

- **`ClickResolver`** — Manages all visual coordinate resolution: UIA accessibility tree lookup → LLaVA LLM visual inference → sub-pixel "Zoom & Retry" crop refinement.
- **`UIMapCoordinator`** — Handles live window snapshotting, UIA tree extraction, cache validation, and lazy UI map refresh post-step.
- **`PlanUtils`** — Stateless helper library for entity extraction, app name inference, and math expression parsing (fully unit-testable).

### Phase 3: Hybrid Vision Perception
Rocky does not click blindly. The `locateUIElement` tool implements a **two-tier hybrid approach**:
1. **Semantic UIA Automation:** PowerShell queries the Windows Accessibility Tree for element names and bounding boxes — fastest and most reliable.
2. **LLaVA Vision ("Zoom & Retry"):** On UIA failure, Rocky captures a screenshot, passes it to LLaVA for rough coordinates, then crops a 300×300px region and re-runs vision for sub-pixel accuracy.

**True Execution Validation:** After every `mouseClick`, Rocky captures a screenshot before and after the action. If the visual delta score is < 0.05%, the click is marked as failed and RECOVER state is triggered.

### Phase 4: Real-Time Voice Pipeline
Rocky is fully conversational with an **offline-first audio pipeline**:
- **Hearing (STT):** Local **Whisper** model with Native Voice Activity Detection (VAD).
- **Speaking (TTS):** Local **Piper TTS** (`en_US-lessac-medium.onnx`) run natively via PowerShell.
- **Follow-Up Window:** After each successful command, a 3-second conversational follow-up window opens — Rocky keeps context active for chained commands without re-invoking the planner.
- **Voice Normalization:** ~30-pattern phonetic error-correction engine (`voiceController`) handles noisy STT output before LLM routing, eliminating a redundant LLM normalization call (~3s latency savings).
- **Confidence Gate:** STT results with confidence < 0.75 are rejected, and Rocky asks the user to repeat.

### Phase 5: The Chief of Staff Delegation Framework
When asked to perform computational tasks (e.g., *"Write a Python script that fetches Bitcoin prices"*), the **`DelegationManager`** instantly offloads the job to a **headless Worker Node** running `Qwen2.5-Coder` in a separate `worker_thread`. A strict thread-pool cap of **3 concurrent workers** prevents system resource exhaustion. Rocky responds immediately via TTS and stays fully conversational while the background worker codes, validates, and finishes.

### Phase 6: Proactive Initiative Engine
Rocky does not wait to be summoned. The **`InitiativeEngine`** runs background observers:
- **File System Watcher:** Monitors `~/Downloads` and `~/Desktop` for new `.pdf`, `.csv`, `.docx`, `.txt`, `.png`, `.jpg` files and proactively offers assistance.
- **Time-Based Scheduler:** Ticks every 60 seconds to fire scheduled triggers (e.g., daily cleanup at 17:00).
- **Night Shift — Autonomic Self-Reflection (02:00):** The `ReflectionEngine` queries the last 100 session logs, batches them through a local Mistral LLM to synthesize implicit behavioral relationships, and injects new fact-triples directly into the Neo4j Knowledge Graph — without any user interaction.

---

## 🧠 Tri-Database Memory System

| Database | Purpose |
|---|---|
| **LanceDB** (Vector) | Semantic embeddings of past workflows + intent cluster routing |
| **Neo4j** (Knowledge Graph) | Relationship fact-triples: `[USER] -[LIKES]→ [COFFEE]`. Graceful offline fallback. |
| **SQLite** (Relational) | Session logs, action history, UI map cache, workflow plan cache |

**Memory Pipeline:**
- **Passive Fact Extraction:** Every user message is non-blockingly analyzed by `factExtractor.js` to extract and upsert entity-relationship triples into both LanceDB and Neo4j.
- **RAG Context Retrieval:** At the start of every run, Rocky parallel-fetches relevant facts, past workflows, and graph context to prime the planner prompt.
- **`userMemory.js`** — LanceDB-backed vector store for semantic memory retrieval.
- **`graphManager.js`** — Neo4j driver wrapper with graceful offline fallback.
- **`workflowCache.js`** — LRU plan cache keyed on intent + entities.
- **`uiMapStore.js`** — In-memory read cache + async write queue for UI element maps.

---

## 🛠️ Full Tool Registry (28 Registered Tools)

| Category | Tool | Description |
|---|---|---|
| **App / System** | `open_resource` | Resolve + open any app or URL via ResourceResolver |
| | `focusWindow` | Bring a named window to the foreground |
| | `waitForAppReady` | Poll until a named app's window is active |
| | `openFolder` | Open a filesystem directory in Explorer |
| | `openChromeProfile` | Launch Chrome with a named profile |
| | `systemControl` | Volume up/down/mute via WScript keyboard events |
| **Files** | `createFileWithContent` | Create a file with specified text content |
| | `openFile` | Open a file with its default application |
| | `searchFiles` | Recursive PowerShell file search in home directory |
| **GUI Automation** | `mouseClick` | Physical mouse click with human-like ±3px random offset |
| | `typeText` | Keyboard text injection via nut.js |
| | `pressKey` | Single key/combo press (supports AutoHotKey-style codes) |
| | `scroll` | Mouse scroll wheel (up/down, configurable amount) |
| | `locateUIElement` | Hybrid UIA + LLaVA element coordinate resolution |
| | `analyze_ui` | Analyze current window with LLaVA vision model |
| | `takeScreenshot` | Capture screen to file (non-destructive, no clipboard) |
| **Desktop Automation (UIA)** | `desktopClick` | UIA accessibility-tree click by element name |
| | `desktopType` | Type into a UIA-located text field |
| **Browser Automation (Playwright)** | `browserOpen` | Open a URL in a managed Playwright browser session |
| | `browserClick` | Click a DOM element by CSS selector |
| | `browserType` | Type into a DOM input by CSS selector |
| | `browserRead` | Extract page text content |
| **Intelligence / Web** | `calculate` | Safe math expression evaluation |
| | `webSearch` | DuckDuckGo scrape + summarization |
| | `fetchAPI` | Raw HTTP GET request |
| | `ocrSearch` | Windows OCR on screenshot region to find text |
| **Communication** | `sendEmailDirect` | Send email via Nodemailer SMTP |

---

## 🛡️ Production Hardening (v2.0 — Completed)

- **System-Wide Non-Blocking Execution:** All `exec()` calls replaced with `execWithTimeout` — guaranteed anti-hang resilience and AgentLoop deadlock prevention.
- **PowerShell Script Staging:** All inline PowerShell commands refactored to secure temp-file staging patterns with safe argument passing.
- **Silent Failure Elimination:** Hardcoded fallback values removed from all telemetry and system metrics queries; explicit error propagation enforced throughout.
- **Non-Destructive Vision Pipeline:** All screenshotting migrated to `screenshot-desktop` native framebuffer access — user clipboard is never touched.
- **Bounded Action Cache:** `actionCache` enforces a 200-entry cap with 30-minute TTL auto-eviction.
- **Xstate Removal:** Legacy `xstate` state machine dependency fully removed; `ConversationalSupervisor` replaced with a plain async class (no startup crash risk).
- **Multi-Monitor Calibration:** OS-to-renderer coordinate translation corrected for high-DPI and multi-monitor setups via `window.screenX/Y`.
- **Background Queue Stack Safety:** `setImmediate` used for recursive background queue processing to prevent call stack overflow on large queues.
- **Smoke Test Suite:** 32+ automated end-to-end tests covering runtime resilience, memory consistency, voice controller transitions, and IPC integrity.

## 🛡️ Production Hardening (v2.1 — Recent Updates)

- **LLM Engine Optimization:** Migrated local inference model to `qwen2.5` for faster execution and highly reliable structured JSON output.
- **Electron GPU Crash Resolution:** Disabled hardware GPU acceleration in Electron while forcing SwiftShader software WebGL, resolving process crashes while keeping 3D avatar rendering intact.
- **Robust App Detection:** Upgraded `waitForAppReady` to utilize process aliases and advanced regex matching on window titles, with soft-failure fallbacks to prevent pipeline blocking.
- **Native Windows OCR:** Introduced a lightning-fast native `winOcr.ps1` PowerShell script using `Windows.Media.Ocr.OcrEngine` for exact on-screen word coordinate extraction.
- **WebGL Error Boundaries:** Implemented React Error Boundaries around the Three.js canvas to ensure graceful degradation if WebGL is entirely unavailable.
- **Vite Port Strictness:** Enforced strict port binding in Vite to prevent silent port shifting, guaranteeing Electron connects to the correct local server.
- **Dynamic Avatar Synchronization:** Integrated the global state manager into the TTS pipeline, enabling the 3D avatar to visually respond and animate in real-time when the agent speaks.

---

## ⚙️ Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Electron 41 + Node.js (ESM) |
| **UI** | React 19, Vite 6, Three.js (3D avatar) |
| **AI Inference** | Ollama (`mistral`, `llava`, `qwen2.5-coder`), OpenAI-compatible API |
| **OS Automation** | Nut.js, PowerShell UIA, WinRT OCR, `screenshot-desktop` |
| **Browser Automation** | Playwright Core (CDP) |
| **Memory** | LanceDB (vector), Neo4j (graph), SQLite / better-sqlite3 (relational) |
| **Voice STT** | Whisper (local, offline) |
| **Voice TTS** | Piper TTS (local ONNX model) |
| **Embeddings** | `@xenova/transformers` (local transformer inference) |
| **IPC** | Electron IPC (main ↔ renderer) + internal `eventBus` (Node EventEmitter) |

---

## 🔮 Future Development Roadmap

1. **Dynamic App & Capability Discovery:** Replace seeded fast-path app registries with dynamic system capability scraping and start-menu enumeration to support any installed application automatically.
2. **Structured LLM Output Enforcement:** Implement grammar-guided JSON schema validation and structured retry loops in the local inference server to guarantee zero formatting hallucinations during complex multi-step tool calls.
3. **Full Multi-Monitor Vision & OCR Capture:** Extend screenshotting and OCR grounding routines beyond `PrimaryScreen` to capture across all virtual display bounding boxes.
4. **VAD Auto-Recovery & Process Resumption:** Integrate automatic watchdog restarts for the local PowerShell VAD process to recover transparently from Windows audio subsystem interruptions or sleep cycles.
5. **Playwright CDP Browser Integration:** Complete Chrome DevTools Protocol DOM grounding to enable fully resilient web application interaction alongside native GUI automation.
6. **Expanded SemanticRouter Cluster Coverage:** Add more pre-trained intent clusters (email, file management, research workflows) to increase the L0 fast-path hit rate and further reduce LLM Planner invocations.
7. **Cross-Platform Support:** Expand Windows-focused PowerShell and UIA automation layers to provide seamless native support for Linux and macOS environments.
