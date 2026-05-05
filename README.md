# 🪨 Rocky AI Agent

**The Autonomous System Guardian & Productivity Partner.**

Rocky is not just an assistant; he is a system-wide agent designed to bridge the gap between your desktop, your communication, and your files. Built with a modular "Aura" architecture, Rocky operates autonomously to keep your digital life flowing.

---

## 🚀 Key Features

### 🧠 Unified Agent Brain
*   **Autonomous Presence**: Rocky checks in spontaneously to offer assistance or updates, powered by a non-blocking background loop.
*   **Intelligent Intent Parsing**: Powered by local `mistral` LLM via Ollama, Rocky understands natural language without sending your data to the cloud.
*   **Hybrid Memory System**: Combines SQLite for relational data and LanceDB for vector-based semantic memory.

### 📁 Universal System Access
*   **Global File Search**: Rocky uses PowerShell-backed recursive searches to find any file in your user profile, not just on the Desktop.
*   **Smart Opener**: Automatically resolves aliases (e.g., "vscode", "excel") and handles web-app redirects (e.g., "yt", "wa").
*   **Folder Intelligence**: Native Windows Explorer integration for deep directory navigation.

### ✉️ Direct Communication
*   **Background Emailer**: Send emails directly via SMTP (Nodemailer) without opening a browser.
*   **Real-Time Activity Feed**: A premium HUD dashboard showing sent mail history and agent status.

### 📸 Automation & Vision
*   **Instant HUD Screenshots**: Captures your screen and auto-opens it for immediate verification.
*   **Vosk STT**: Completely offline Speech-to-Text engine for private voice control.

---

## 🛠️ Setup & Installation

### 1. Prerequisites
*   **Node.js**: v18+
*   **Ollama**: Installed and running with the following models:
    ```bash
    ollama pull mistral
    ollama pull llava
    ```

### 2. Environment Configuration
Create a `.env` file in the root directory (use the provided placeholders):
```env
# AI Providers
OPENAI_API_KEY=your_key_here

# Direct Email (SMTP)
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-google-app-password
```

### 3. Installation
```bash
npm install
npm run dev
```

---

## ⌨️ Command Shortcuts

| Command | Action |
| :--- | :--- |
| `open yt` | Launches YouTube + Creates Desktop Icon |
| `open wa` | Launches WhatsApp + Creates Desktop Icon |
| `open [filename]` | Searches entire system and opens file |
| `send email to [x]` | Sends a background email via SMTP |
| `take screenshot` | Captures and pops up your screen |
| `search [query]` | Performs a global profile-wide file search |

---

## 🎨 Design Philosophy: "The Aura HUD"
Rocky's UI is built on **Glassmorphism** and **Dynamic Presence**. 
*   **Deep Translucency**: High-blur panels for a futuristic feel.
*   **Neon Accents**: Cyber-cyan glow for active states.
*   **Animated Feed**: Real-time activity cards for background tasks.

---

## 🔒 Security & Privacy
*   **Offline First**: Logic and Voice processing happen locally.
*   **App Passwords**: Secure SMTP handling via environment variables.
*   **Safe Shell**: PowerShell commands are sanitized and run with restricted permissions.

---

**Rocky is ready. Everything is flowing. Amaze.** 🪨🚀
