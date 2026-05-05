# Project Hailmary – Rocky: Autonomous Desktop AI Agent

## Overview
**Rocky** is a system-level, autonomous desktop AI agent designed to interact with the Windows Operating System dynamically. Unlike traditional assistants that rely on hardcoded application hooks, Rocky operates as a generalized agent. It "sees" the screen, "hears" voice commands, understands the layout of the UI, and executes native mouse and keyboard commands to accomplish tasks across *any* application.

Rocky is built on a Node.js + Electron architecture and relies heavily on local/remote LLMs (Mistral/OpenAI) for reasoning and Vision Language Models (LLaVA) for perception.

---

## 1. Core Architecture & Modules

The system is designed as a strict, contract-enforced pipeline moving from raw user input to physical execution.

### A. Voice & STT Pipeline
- **Web Speech API & IPC:** Voice is captured via the browser/renderer using the Web Speech API and sent to the main process via IPC.
- **Confidence Gates:** If the Speech-to-Text confidence is below `0.75`, the system stops and asks the user to repeat the command.
- **LLM Normalizer:** A local LLM normalizes messy STT output (e.g., "clik snd btn" -> "click send button") to provide a clean string to the reasoning engine, falling back to fast-rules for high-speed tasks like volume control.

### B. Cognitive Engine (The Brain)
- **IntentParser:** Analyzes the normalized input to determine if it is `actionable` (requires system interaction) or purely `conversational` (small talk). It strictly assigns a `route` (`execution` vs `conversation`) to prevent the system from trying to execute a greeting.
- **Planner:** Enforces a strict JSON Schema output (`{ "steps": [{ "tool": "tool_name", "input": {...} }] }`). It is fed the list of available tools from the Tool Registry. It handles multi-step workflows by using the literal string `$LAST_OUTPUT` to chain tool results.

### C. The Orchestrator (AgentLoop)
The execution loop is not linear; it is a **State Machine** (`PLAN → EXECUTE → VALIDATE → RECOVER → COMPLETE`).
- **PLAN:** Routes conversation, checks for learned shortcuts, or queries the AI Planner for a tool strategy.
- **EXECUTE:** Checks for cached successful actions to optimize performance. Executes the tool.
- **VALIDATE:** **True Execution Validation.** The system captures a screenshot before and after the action. If the UI did not visually change (change score < 0.05%), the action is marked as failed.
- **RECOVER:** A smart recovery loop. If a tool fails due to invalid schema, it re-plans with a constraint prompt. If a click fails, it falls back to the Vision system.

### D. Perception (Hybrid Vision System)
Rocky does not click blindly. The `locateUIElement` tool uses a two-tier hybrid approach:
1. **Semantic UI Automation (UIA):** Fastest and most reliable. It uses a PowerShell script to query the Windows Accessibility Tree for element names and bounding boxes.
2. **Vision (LLaVA "Zoom & Retry"):** If the semantic tree fails, Rocky takes a screenshot and passes it to LLaVA for rough coordinates. It then crops a 300x300 pixel square around the guess and runs vision again for sub-pixel accuracy.

### E. Execution (GUI Control)
- Uses PowerShell `mouse_event` scripts to physically move the cursor and click.
- Features human-like random offsets (±3px) to bypass basic bot-detection.
- Supports fallback keyboard macros (e.g., trying to press `{ENTER}` instead of clicking if the element is focused).

### F. Learning & Memory
- **Correction Handler:** The system can learn from the user. If the user says "No Rocky, use Ctrl+P", the correction handler maps the previous intent to a direct keyboard action in the Knowledge Graph. Future commands for that intent will bypass the LLM and execute the mapping directly.

---

## 2. strict Contracts & Design Philosophy

If you are developing or modifying Rocky, you MUST adhere to the following design rules:
1. **Never Assume Success:** Do not assume a script execution means a successful OS interaction. You must use the `verifyExecution` (visual delta) logic to prove the UI changed.
2. **Schema Immunity:** The Planner must sanitize all LLM outputs to strip out JSON schema definitions (`type`, `properties`).
3. **No App-Specific Hardcoding:** Rocky must be able to open Notepad the exact same way he opens YouTube. Use the Hybrid Vision system and intent generalization to figure out UIs on the fly.
4. **State Machine Integrity:** The Agent Loop must never get stuck in infinite retries. Always use the `RECOVER` state to rethink the plan or gracefully fail and ask the user.

---

## 3. Tech Stack Summary
- **Framework:** Electron + Node.js
- **OS Control:** PowerShell (UIA Accessibility API, Mouse/Keyboard Events)
- **AI Integration:** Local/Remote LLM endpoints (`aiProvider`) via structured generation.
- **Storage:** SQLite/LanceDB for persistent Knowledge Graph and shortcut learning.
