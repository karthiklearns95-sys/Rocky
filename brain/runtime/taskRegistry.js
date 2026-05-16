/**
 * taskRegistry.js
 * 
 * Tracks all active promises, tools, and orchestration loops to ensure
 * no orphaned tasks or memory leaks occur during an abort or interrupt.
 */

class TaskRegistry {
  constructor() {
    this.activeTasks = new Map();
    this.idCounter = 0;
  }

  /**
   * Registers a task and returns a cleanup function
   */
  register(type, metadata = {}) {
    const id = ++this.idCounter;
    this.activeTasks.set(id, { type, metadata, startTime: Date.now() });
    
    return () => {
      this.activeTasks.delete(id);
    };
  }

  /**
   * Returns information about all currently running tasks
   */
  getActiveTasks() {
    return Array.from(this.activeTasks.values());
  }

  /**
   * Clears the registry (called upon global abort cleanup)
   */
  clear() {
    this.activeTasks.clear();
  }
}

export const taskRegistry = new TaskRegistry();
