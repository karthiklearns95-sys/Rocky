/**
 * PresenceManager
 * Manages Rocky's spontaneous background presence.
 * If Grace hasn't interacted for a configured period, Rocky might initiate conversation.
 */
export default class PresenceManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.idleTimer = null;
    
    // Configurable timeout (default 30 seconds for testing)
    this.TIMEOUT_MS = process.env.PRESENCE_TIMEOUT_MS ? parseInt(process.env.PRESENCE_TIMEOUT_MS, 10) : 30000;
    
    this.isActive = false;
  }

  start() {
    this.isActive = true;
    this.resetTimer();
    console.log(`[PresenceManager] Started with timeout: ${this.TIMEOUT_MS}ms`);
  }

  stop() {
    this.isActive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }

  /**
   * Called whenever Grace interacts (typing or speaking)
   */
  resetTimer() {
    if (!this.isActive) return;

    if (this.idleTimer) clearTimeout(this.idleTimer);
    
    this.idleTimer = setTimeout(() => {
      this.triggerPresence();
    }, this.TIMEOUT_MS);
  }

  /**
   * Rocky autonomously initiates an interaction
   */
  triggerPresence() {
    console.log('[PresenceManager] Triggering spontaneous interaction...');
    
    // Fire a synthetic input into the brain that acts as an autonomous thought
    const spontaneousPrompt = "AUTONOMOUS_PRESENCE_TRIGGER: Check in with Grace gently. Ask if she needs anything or make a brief, curious observation about saving stars.";
    
    // Emit to the main system
    this.eventBus.emit('USER_INPUT', spontaneousPrompt);
    
    // Reset timer so he doesn't immediately fire again
    this.resetTimer();
  }
}
