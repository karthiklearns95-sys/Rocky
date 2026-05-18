# 🪨 Project Rocky (Hailmary)
### Infrastructure-Grade Autonomous OS Orchestration Engine

[![Architecture: Agentic Loop](https://img.shields.io/badge/Architecture-Agentic%20Loop-orange)](https://github.com/your-repo/rocky#agent-loop)
[![Memory: Hybrid Vector-Graph](https://img.shields.io/badge/Memory-Hybrid%20Vector--Graph-green)](https://github.com/your-repo/rocky#memory-system)
[![Status: Production Locked](https://img.shields.io/badge/Status-Phases%201--10%20Locked-blue)](#)

---

## 📋 Executive Overview

Project Rocky (codename Hailmary) is a modular, high-performance, and fully autonomic AI desktop companion. Evolving past simple reactive chat agents, Rocky serves as a multi-threaded OS execution layer capable of contextual reasoning, visual UI validation, background autonomic learning, and real-time human continuity. 

---

## 🏗️ The Ten Core Pillars (System Architecture)

Rocky has been successfully refactored through a 10-phase hardening cycle to achieve infrastructure-grade reliability.

### 1. The UIA IPC Infrastructure
Replaced fragile PowerShell loops with a persistent C# Win32 daemon (`\\.\pipe\UIA_ROCKY_PIPE`), dropping execution latency to near 0ms for native desktop automation.

### 2. Semantic Intent Routing
Swapped brittle Regex-based intent parsing with a localized LanceDB vector router, deterministically pushing fast-path requests straight to execution without taxing the LLM.

### 3. Strict Context Management
Implemented a highly budgeted, 4-way parallel context bouncer that compiles Active OS focus, Semantic Vectors, SQLite dialogue history, and Neo4j relations into a unified payload to prevent LLM hallucination.

### 4. Knowledge Graph Weaponization
Fully integrated `neo4j-driver` and a depth-1 extraction pipeline, allowing Rocky to understand complex entity relationships (e.g., "Alex is MANAGER_OF Sales").

### 5. Localized Perception Fallback
When standard OS accessibility trees fail, the system reflexively falls back to local OpenCV and Tesseract OCR to visually locate buttons and calculate exact screen coordinates for raw mouse execution.

### 6. Autonomic Supervisor
A low-level WinEventHook pipeline that tracks system interruptions. If a popup steals focus, or the user physically moves the mouse, the supervisor instantly halts the agent, attempts recovery, or safely aborts.

### 7. The Initiative Engine
Rocky is no longer strictly reactive. The Initiative Engine monitors file system changes (`Downloads`/`Desktop`) and time-based triggers, queuing synthetic tasks into the orchestrator automatically.

### 8. Sub-Agent Delegation (Headless Workers)
Utilizing Node.js `worker_threads`, long-running cognitive tasks (parsing, database mining) are offloaded to headless worker clones, ensuring the primary UI loop never drops a frame.

### 9. Autonomic Self-Reflection (The Night Shift)
At 2:00 AM, the agent spins up a background thread to synthetically batch-analyze the daily SQLite conversational logs, distilling human habits into persistent long-term relationships within Neo4j.

### 10. The Ambient Telemetry HUD (Aura)
A frameless, transparent, hardware-accelerated Electron overlay pinned to the desktop that visualizes the agent's internal multi-threaded state (Idle, Thinking, Executing, Aborted) in real-time, providing immediate psychological feedback to the user.

---

## 🔄 The Pipeline Layout

```mermaid
graph TD
    Input([Voice / Proactive Trigger]) --> Intent[Semantic Router (LanceDB)]
    Intent --> Context[Context Bouncer (4-Way DB Snapshot)]
    Context --> Planner[Workflow Planner (LLM)]
    
    Planner --> Orchestrator{Agent Loop}
    Orchestrator -- Heavy Task --> Worker[Delegation Manager (Worker Threads)]
    Orchestrator -- UI Task --> UIA[C# UIA Daemon (Native Pipe)]
    
    UIA -- Accessibility Blindspot --> Vision[Perception Engine (OCR / OpenCV)]
    Vision --> Execute([OS Execution])
    
    Supervisor[[Autonomic Supervisor]] -. Monitors .- Execute
    Execute --> Reflection[Night Shift: Neo4j Sync]
    
    Orchestrator --> Aura[Aura HUD Telemetry Emit]
```

---

## 🛡️ Execution Safety & Privacy

- **Physical Kill-Switch:** Physical mouse movement > 50px immediately aborts all underlying execution sequences.
- **Strict Cypher Writes:** Knowledge Graph updates exclusively utilize `MERGE` parameters, avoiding memory bloat or edge duplication.
- **Local Isolation:** The entire memory matrix runs entirely on localhost with zero external cloud sync dependencies.

## 🚀 Deployment Status
**PHASES 1-10 COMPLETE. REPOSITORY FROZEN.**
