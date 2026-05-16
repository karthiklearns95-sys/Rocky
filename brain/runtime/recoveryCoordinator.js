import { taskRegistry } from './taskRegistry.js';
import { abortManager } from './abortManager.js';
// We will also import the Playwright and UIA managers if needed to explicitly stop things,
// but usually wrapping them with `withGuard` is enough if they respect signals.

/**
 * recoveryCoordinator.js
 * 
 * Safely collapses the runtime back to an IDLE state, clearing all registries,
 * retries, and active validation loops without memory leaks.
 */

class RecoveryCoordinator {
  constructor() {
    this.currentState = 'IDLE'; // IDLE, RUNNING, INTERRUPTING, RECOVERING, FAILED
  }

  setState(newState) {
    console.log(`[Runtime] State Transition: ${this.currentState} -> ${newState}`);
    this.currentState = newState;
  }

  getState() {
    return this.currentState;
  }

  /**
   * Called when an interrupt command is received (e.g. "stop", "nevermind").
   */
  async handleInterrupt(reason = "User requested stop") {
    if (this.currentState === 'IDLE') return;

    this.setState('INTERRUPTING');
    
    // 1. Issue global abort
    abortManager.abort(reason);

    // 2. Clear task registry
    taskRegistry.clear();

    // 3. Allow event loop to tick so Promises can throw AbortError
    await new Promise(resolve => setTimeout(resolve, 50));

    // 4. Safely return to IDLE
    this.setState('IDLE');
    abortManager.reset();

    console.log(`[Runtime] Interruption complete. Safe to route new intent.`);
  }
}

export const runtimeCoordinator = new RecoveryCoordinator();
