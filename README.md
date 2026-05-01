# Project Hailmary

> [!WARNING]
> **🚧 Work in Progress 🚧**
> This project is currently under active development. Features, architecture, and implementations are subject to change.

**Hailmary** is a production-grade, state-driven AI desktop companion system. It features a floating animated desktop agent named **Rocky**. It is designed to be modular, scalable, and future-proof, acting not just as a chatbot but as a system-level executor with memory and an animated presence.

## 🚀 Features

- **Floating UI Companion:** An always-on-top, frameless, and transparent window built with Electron and React.
- **State-Driven Animation:** A React-Three-Fiber 3D character whose animations and visual effects react dynamically to its internal states (`idle`, `listening`, `thinking`, `speaking`, `moving`).
- **Abstracted AI Brain:** The AI processing pipeline (`Intent -> Context -> Plan -> Decision -> Response`) is completely decoupled from any specific API, allowing seamless swapping between cloud APIs (e.g., OpenAI) and local models (e.g., LLaMA).
- **Safe Execution:** A dedicated `ToolManager` and `CommandExecutor` safely handle system tasks with a built-in `PermissionManager` to prevent destructive actions.
- **Asynchronous EventBus:** Entire architecture communicates asynchronously to keep the UI smooth and responsive while heavy AI/OS tasks run in the background.

## 🏗️ Architecture

```
hailmary/
│
├── app/                     # Electron entry point (main.cjs, preload.cjs)
├── ui/                      # React UI & Three.js 3D Rendering
├── controller/              # StateManager and central EventBus
├── brain/                   # AI Pipeline (Intent, Context, Planner, Decision, Response)
│   └── aiProvider/          # Abstract BaseProvider (ApiProvider, LocalProvider)
├── tools/                   # Extensible Actions & ToolManager
├── executor/                # CommandExecutor & PermissionManager
├── memory/                  # Memory abstraction (SQLite / VectorDB / Graph)
├── voice/                   # Speech-to-Text and Text-to-Speech Controllers
├── shared/                  # Common utilities & types
└── config/                  # App configuration
```

## 🧠 Brain Pipeline

The core logic ensures Rocky does not execute tasks directly but orchestrates them safely:

1. **Intent Parser:** Analyzes user input to determine the goal.
2. **Context Loader:** Retrieves relevant historical data from Memory.
3. **Planner:** Generates a sequence of tool requests based on intent.
4. **Decision Engine:** Evaluates the plan and passes tasks to the Tool Manager.
5. **Response Formatter:** Generates a conversational response based on tool execution results.

## 📦 Setup & Installation

**Prerequisites:**
- Node.js (Version 22.11.0 or supported equivalent)
- npm

```bash
# Install dependencies
npm install

# Start the dev server and Electron app
npm run dev
```

## 🛠️ Modularity and Future-Proofing

This system is built under the core principle: **"Will this code still work when APIs are replaced with local models?"**

Because all AI calls route through `brain/aiProvider/baseProvider.js`, upgrading to full local execution (e.g., using `node-llama-cpp` or `Ollama`) requires only dropping in a new Provider implementation without changing the Brain pipeline or UI.

## 🤖 Meet Rocky

Rocky addresses the user as "Grace" and acts as a helpful, concise companion capable of interacting with the host Operating System.
# Rocky
