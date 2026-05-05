# 🪨 Rocky Status Report: Incomplete Work & Next Steps

This document outlines the current state of Project Hailmary after the **Universal Agent Refactor**.

## ✅ WHAT IS COMPLETED
*   **Universal Loop**: Rocky now observes the active window before acting.
*   **Action Mapping**: Basic intents (pause, next, save) are dynamically mapped to keys.
*   **Smart Launch**: Rocky can now resolve "App Name" vs "Web URL" automatically.
*   **Standardized Tools**: All tools return structured JSON `{ success, data, error }`.
*   **Aura HUD**: The premium visual interface and activity feed are active.

## 🚧 WHAT IS INCOMPLETE (WORK IN PROGRESS)

### 1. Vision Precision (The "LLaVA Gap")
*   **Current State**: LLaVA is integrated and returns JSON, but the **Coordinate Accuracy** needs tuning.
*   **Missing**: A "Zoom & Retry" loop if the first detection confidence is < 70%.
*   **Goal**: Rocky should be able to click a 20x20 pixel button consistently.

### 2. The Learning Loop (User Corrections)
*   **Current State**: The `appProfiles` system exists in code, but there is no **Voice Trigger** to correct him.
*   **Missing**: A command like *"No Rocky, use Ctrl+P for Print in this app"* which should trigger `saveLearnedMapping`.
*   **Goal**: Rocky should learn your specific shortcuts for any software.

### 3. Multi-Step Complexity
*   **Current State**: Rocky can do 1-2 steps well.
*   **Missing**: Robust handling for long chains (e.g., "Open Chrome, search for stars, take a screenshot, and email it to Grace").
*   **Goal**: Stable execution of 5+ tool chains without hallucination.

### 4. App Context Edge-Cases
*   **Current State**: `getActiveWindow` works for standard apps.
*   **Missing**: Handling for "Floating Windows", "System Dialogs", and "Minimized State".
*   **Goal**: Rocky should know when an app is minimized and offer to "Focus" it first.

## 🎯 NEXT ACTIONS
1.  **Refine LLaVA Prompting**: Force even stricter coordinate output.
2.  **Implement Correction Command**: "Rocky, learn [shortcut] for [intent]".
3.  **Stress Test Chained Reasoning**: Start running "Combo" commands.

---
*Rocky is 85% evolved. The remaining 15% is about precision and memory.* 🪨🚀
