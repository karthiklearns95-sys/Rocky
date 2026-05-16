/**
 * abortManager.js
 * 
 * Manages the global AbortController and handles system-wide cancellation
 * signals to instantly stop planners, tools, and execution loops.
 */

class AbortManager {
  constructor() {
    this.controller = new AbortController();
  }

  getSignal() {
    return this.controller.signal;
  }

  isAborted() {
    return this.controller.signal.aborted;
  }

  /**
   * Instantly aborts all running tasks that are listening to the signal
   */
  abort(reason = 'User cancelled the task') {
    if (!this.isAborted()) {
      console.log(`[AbortManager] 🛑 Issuing global abort: ${reason}`);
      this.controller.abort(reason);
    }
  }

  /**
   * Resets the controller for a new workflow
   */
  reset() {
    if (this.isAborted()) {
      this.controller = new AbortController();
      console.log(`[AbortManager] 🔄 Reset global abort controller. System ready.`);
    }
  }
}

export const abortManager = new AbortManager();
