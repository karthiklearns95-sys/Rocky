# Rocky: An Autonomous AI Agent Platform

## Overview
Rocky is a privacy-first, autonomous AI agent platform designed for local desktop automation and intelligent task execution. Built with security and confidentiality in mind, it operates entirely without relying on cloud APIs, ensuring that all data processing, decision-making, and execution happen locally on the host machine. 

By leveraging advanced state-machine orchestration and local LLM inference, Rocky provides deterministic, state-aware execution for complex automation tasks.

## System Architecture

Rocky is built upon a highly structured 4-layer architecture, ensuring separation of concerns, scalability, and robust error handling.

### Architecture Flow Diagram
```text
[User Request]
      │
      ▼
┌─────────────────────────┐      ┌─────────────────────────┐
│  LangGraph Supervisor   │◄────►│         Ollama          │
│ (Orchestration Layer)   │      │   (Inference Layer)     │
└────────────┬────────────┘      └─────────────────────────┘
             │
             ▼
┌─────────────────────────┐
│      Electron IPC       │
│   (Execution Layer)     │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│     GUI Automation      │
│  (OS & Window Control)  │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Screenshot Validation  │
│  & State Verification   │
└────────────┬────────────┘
             │
             │ (Recovery/Success Loop)
             └─────────────────────────────► [Back to LangGraph / Done]
```

### The 4-Layer Architecture

1. **Orchestration Layer (LangGraph):** 
   Utilizes a LangGraph state machine to enforce deterministic, state-aware execution boundaries over the LLM. This supervisor module controls the lifecycle of agent actions, ensuring predictable behavior and managing the overall task state.
2. **Inference Layer (Ollama):** 
   Fully local inference utilizing Ollama to host quantized open-source models (e.g., Llama 3, Mistral). This ensures complete data privacy and low-latency response generation without external dependencies.
3. **Context & Memory Layer (LanceDB & SQLite):** 
   A hybrid memory system designed for rapid recall and persistent state tracking:
   - **LanceDB:** Drives vector-based semantic memory retrieval across 1,200+ embeddings, utilizing sliding-window management to maintain relevant conversational context.
   - **SQLite:** Handles relational state tracking for structured operational data and historical logs.
4. **Execution Layer (Electron IPC):** 
   An Electron Inter-Process Communication (IPC) bridge that securely connects the AI core to OS-level GUI automation tools and PowerShell scripts, executing physical desktop actions on behalf of the agent.

## Key Engineering Features

- **Hierarchical Tool Routing:** 
  The platform dynamically routes between 25+ integrated tools into functional sub-graphs. This hierarchical approach prevents local LLM context degradation and mitigates the risk of hallucinated parameters, ensuring tools receive exact and valid inputs.
- **Multimodal State Validation:** 
  Rocky employs screenshot-based validation where post-action UI states are visually analyzed. This critical feedback mechanism detects stalls, unexpected windows, or incomplete actions, closing the loop on execution certainty.
- **Recovery-Driven Automation:** 
  Built-in programmatic error-handling loops within LangGraph catch execution failures and pass them back to the model. This allows for automated self-correction and healing, drastically reducing the need for human intervention when exceptions occur.

## Future Development Roadmap
*(Currently Pending/Not Yet Implemented)*

The following features outline the strategic vision for the next iteration of the Rocky platform. These capabilities are currently in the planning or early development phases:

- **Advanced Knowledge Graph Integration (Ji):** 
  Developing a unified knowledge-base module designed to link local desktop operational history with broader conceptual reasoning. This will allow the agent to build deep, contextual understandings of user workflows over time.
- **Cross-Platform OS Support:** 
  Expanding the current Windows-focused PowerShell and GUI automation layers. The goal is to provide seamless, native support for Linux and macOS environments, abstracting OS-level differences from the core agent logic.
- **Distributed Multi-Agent Collaboration:** 
  Enabling multiple specialized local agent instances to communicate, delegate, and execute sub-tasks asynchronously via an event-driven message broker. This will allow for complex, parallelized workflows handled by specialized AI workers.
