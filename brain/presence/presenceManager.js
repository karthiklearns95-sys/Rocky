/**
 * PresenceManager
 * Manages Rocky's spontaneous background presence.
 * If Grace hasn't interacted for a configured period, Rocky might initiate conversation.
 */
export default class PresenceManager {
  /**
   * @param {object} eventBus
   * @param {{curiosity?: object, canSpeak?: () => boolean}} [opts] curiosity lets Rocky
   *   ask a question about something he doesn't know; canSpeak tells him when Grace is busy.
   */
  constructor(eventBus, opts = {}) {
    this.eventBus = eventBus;
    this.curiosity = opts.curiosity || null;
    this.canSpeak = opts.canSpeak || (() => true);
    this.idleTimer = null;
    this.isFiring = false; // Guard: prevents flooding while Rocky is already responding

    // Min cooldown between autonomous triggers (default 3 minutes, override via env)
    this.TIMEOUT_MS = process.env.PRESENCE_TIMEOUT_MS
      ? parseInt(process.env.PRESENCE_TIMEOUT_MS, 10)
      : 180000; // 3 minutes

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

  /** Called whenever Grace interacts — resets the idle countdown */
  resetTimer() {
    if (!this.isActive) return;
    if (this.isFiring) return; // Don't reset while Rocky is mid-response

    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.idleTimer = setTimeout(() => {
      this.triggerPresence();
    }, this.TIMEOUT_MS);
  }

  /** Rocky autonomously initiates an interaction */
  triggerPresence() {
    if (this.isFiring) return; // Already firing — skip
    this.isFiring = true;

    console.log('[PresenceManager] Triggering spontaneous interaction...');
    const spontaneousPrompt =
      'AUTONOMOUS_PRESENCE_TRIGGER: Check in with Grace gently. Ask if she needs anything or make a brief, curious observation.';

    // Prefer a real question about something Rocky doesn't know yet.
    const fallback = () => this.eventBus.emit('USER_INPUT', spontaneousPrompt);
    if (this.curiosity && this.canSpeak()) {
      this.curiosity.nextQuestion()
        .then((q) => {
          if (q && this.canSpeak()) {
            this.curiosity.markAsked(q);
            this.eventBus.emit('RESPONSE_READY', q.text);
          } else {
            fallback();
          }
        })
        .catch(fallback);
    } else {
      fallback();
    }

    // Restart timer after a full cooldown (not immediately)
    setTimeout(() => {
      this.isFiring = false;
      this.resetTimer();
    }, this.TIMEOUT_MS);
  }
}
