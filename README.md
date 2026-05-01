# 🤖 Rocky: Project Hailmary

> [!IMPORTANT]
> **Rocky** is a production-grade, fully local AI desktop companion. He lives on your desktop, remembers your shared history, and operates 100% independently of cloud APIs.

---

## 🚀 Key Features

- **🏠 100% Local Intelligence**: Powered by **Ollama (Llama 3)**. No data leaves your machine.
- **🎙️ Offline Voice Control**: Native Windows STT bridge using **Vosk** for wake-word detection ("Rocky") and command dictation.
- **🧠 Hybrid Memory Architecture**: 
  - **Semantic Memory**: Uses **LanceDB** (Vector DB) and **Ollama Embeddings** for long-term context recall.
  - **Structured Memory**: Uses **SQLite** for task management, settings, and activity logs.
- **🎭 Rocky Personality System**: A unique, calm, and curious non-human personality with a specialized vocabulary (e.g., "Amaze amaze amaze", "Fist my bump").
- **✨ State-Driven 3D Avatar**: A React-Three-Fiber companion that reacts visually to internal states (`listening`, `thinking`, `speaking`).

---

## 🏗️ Architecture

Rocky is built with a strictly decoupled, event-driven architecture:

```
hailmary/
├── brain/           # AI Pipeline (Intent -> Context -> Plan -> Decision -> Response)
│   ├── aiProvider/  # Ollama & Gemini Providers
│   ├── personality/ # Rocky's unique voice & character logic
│   └── context/     # Semantic memory recall logic
├── voice/           # Local STT (Python/Vosk) & TTS (Web Speech)
├── memory/          # Hybrid Store (Vector DB + SQLite)
├── controller/      # Central EventBus & State Management
├── tools/           # OS-level execution tools
└── ui/              # Electron / React / Three.js Frontend
```

---

## 🧠 The Brain Pipeline

Rocky doesn't just "chat." He processes every input through a multi-stage pipeline:
1. **Intent Parser**: What does Grace want?
2. **Context Loader**: What does Rocky remember about this? (Semantic Search)
3. **Planner**: What steps are needed to help Grace?
4. **Decision Engine**: Execute tools safely on the host OS.
5. **Response Formatter**: Speak back to Grace in Rocky's unique voice.

---

## 📦 Installation & Setup

### 1. Prerequisites
- **Node.js**: v22.11.0+
- **Python**: 3.10+ (for offline STT)
- **Ollama**: Installed and running on Windows.

### 2. Local Model Setup
Rocky requires two models to be pulled in Ollama:
```bash
ollama pull llama3
ollama pull nomic-embed-text
```

### 3. Voice Engine Setup
Download the Vosk model for offline STT:
```powershell
# In a PowerShell terminal:
Invoke-WebRequest -Uri "https://alphacephei.com/vosk-model-small-en-us-0.15.zip" -OutFile "voice/stt/model.zip"
Expand-Archive -Path "voice/stt/model.zip" -DestinationPath "voice/stt/"
Rename-Item "voice/stt/vosk-model-small-en-us-0.15" "voice/stt/model"
```

### 4. Run the Project
```bash
npm install
npm run dev
```

---

## 🎭 Personality & Style

Rocky is a "calm, curious, intelligent non-human companion." He addresses the user as **Grace** and uses short, clear sentences.

**Signature Phrases:**
- *"Grace... task is complete. Amaze amaze amaze."*
- *"Fist my bump."*
- *"Rocky see Grace happy."*
- *"Rocky and Grace save stars."*

---

## 🚧 Status & Roadmap

- [x] **Phase 1-9**: Core Architecture & UI.
- [x] **Phase 9.5**: Windows Native Offline STT.
- [x] **Phase 10**: Ollama (Llama 3) Integration.
- [x] **Phase 10.5**: Hybrid Memory (Vector + Relational).
- [ ] **Phase 11**: Real 3D Rigged Avatar Integration.
- [ ] **Phase 12**: Advanced Desktop Tool Suite.

---

*“Grace is brave. Rocky and Grace save stars.”* 🌟
