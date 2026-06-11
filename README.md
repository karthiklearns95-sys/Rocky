# Rocky: Advanced Local Autonomous AI Agent

## Overview
Rocky is a highly experimental, privacy-first autonomous AI agent platform designed for local desktop automation, deep contextual memory, and proactive intelligent assistance. Built entirely to run on local hardware without cloud API dependencies, Rocky ensures complete data privacy and true offline execution.

Rocky has evolved beyond a simple LangGraph state machine into a true **multi-threaded, voice-enabled Chief of Staff** powered by a custom **Unified Agent Loop**.

## 🚀 The 5-Phase Architecture (Current State)

Rocky is built on a highly structured, scalable architecture that we have systematically implemented across 5 major phases:

### Phase 1: The God Mode Loop (Initiative Engine)
Rocky does not wait to be spoken to. The **Initiative Engine** runs asynchronously in the background, utilizing scheduled screen-captures and a local Vision model (`llava`) to silently observe your desktop. If you are stuck on a complex spreadsheet or reading a long document, Rocky can proactively intervene and offer assistance out loud.

### Phase 2: The Semantic Router
To eliminate LLM latency for simple tasks, Rocky uses a **Fast-Path Semantic Router**. By analyzing incoming intents against a vector index, Rocky can completely bypass the LLM "thinking" phase for basic macros. Commands like *"Open Spotify"*, *"Mute the volume"*, or *"Take a screenshot"* execute instantly via direct OS-level integrations.

### Phase 3: The Tri-Database Memory System
Rocky possesses infinite, structured memory across three specialized local databases:
1. **LanceDB (Vector Database):** Stores semantic embeddings of past workflows, allowing Rocky to dynamically pull successful strategies from past automations.
2. **Neo4j (Knowledge Graph):** Extracts and stores relationship fact-triples (e.g., `[USER] -[LIKES]-> [COFFEE]`). This allows Rocky to logically deduce facts and remember personal preferences permanently.
3. **SQLite (Relational Database):** Handles strict operational state tracking and system logs.

### Phase 4: Real-Time Voice (Local Audio Pipeline)
Rocky is fully conversational. 
- **Hearing:** Uses a local offline **Whisper** model paired with Native Voice Activity Detection (VAD).
- **Speaking:** Uses a local **Piper TTS** model (`en_US-lessac-medium.onnx`) running natively through PowerShell for lightning-fast, high-quality audio responses. 
- **Conversational Supervisor:** Powered by **XState 5**, this non-blocking state machine manages the conversational flow, allowing Rocky to chat with you while simultaneously delegating heavy tasks.

### Phase 5: The Chief of Staff Delegation Framework
Rocky is a multi-tasker. When asked to perform heavy computational tasks (like *"Write a Python script that fetches Bitcoin prices"*), the XState Supervisor instantly offloads the task to a **Headless Worker Node** running `Qwen2.5-Coder` in a separate `worker_thread`. Rocky will immediately reply to you out loud ("I'm on it!"), allowing you to continue conversing while the background worker invisibly writes, validates, and executes the code via the `ToolManager`.

---

## 🧠 Core Engineering Features

- **Unified Agent Loop:** Replaced fragmented LangGraph engines with a unified, robust loop capable of mid-workflow redirection. If Rocky is in the middle of a task and you shout *"Stop!"*, the `AbortManager` globally halts all tool execution instantly.
- **Hierarchical Tool Routing (25+ Tools):** Rocky possesses physical control over the OS. Using Playwright (browser automation) and Nut.js/UIA (desktop automation), Rocky can physically click, type, and navigate any application on your machine.
- **Multimodal State Validation:** Rocky validates tool execution by taking screenshots and analyzing the UI state post-action, ensuring a button click actually resulted in the expected screen change.

## ⚙️ Technology Stack
- **Inference:** Ollama (`mistral`, `llava`, `qwen2.5-coder`)
- **Orchestration:** XState 5 (Finite State Machines)
- **Frontend:** React, Vite, Electron IPC
- **Memory:** Neo4j, LanceDB, SQLite
- **Voice:** Whisper (STT), Piper (TTS)

## 🔮 Future Development Roadmap
*(Currently Pending/Not Yet Implemented)*
- **Cross-Platform OS Support:** Expanding the current Windows-focused PowerShell and GUI automation layers to provide seamless, native support for Linux and macOS environments.
- **Swarm Intelligence:** Upgrading the Delegation Framework to support multiple, highly specialized agents debating and solving complex multi-step software engineering tickets collaboratively.
