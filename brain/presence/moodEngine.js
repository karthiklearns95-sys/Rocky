/**
 * MoodEngine - how Rocky feels, and how Grace seems to be doing.
 *
 * Rocky's mood comes from what just happened (tasks that worked or failed,
 * kind or harsh words, a question he asked), the time of day, and how long it
 * has been quiet. Feelings fade back to calm over a few minutes.
 *
 * Mood labels (drive the avatar and the tone of his replies):
 *   neutral | happy | proud | excited | curious | worried | sleepy
 *
 * It also watches for signs that Grace needs care (long unbroken work, being
 * tired late at night) and can offer one short, throttled message about it.
 *
 * Pure logic with an injectable clock, so it is fully testable. When given an
 * eventBus it emits 'MOOD_CHANGE' with the new mood whenever the label changes.
 */

const MIN = 60 * 1000;

const POSITIVE = /\b(thanks|thank you|thx|great|awesome|amaze|amazing|love|perfect|nice|good job|well done|cool|brilliant|yay|excellent|wonderful|fantastic)\b/i;
const NEGATIVE = /\b(stupid|useless|wrong|hate|terrible|awful|bad|annoying|ugh|damn|broken|worst|idiot|shut up|not working)\b/i;
const NEGATION = /\b(not|no|never|isn't|aren't|don't|doesn't|wasn't|can't)\s+(\w+\s+)?$/i;
const TIRED = /\b(tired|exhausted|sleepy|burned out|burnt out|drained|so late|need sleep|can't sleep)\b/i;
const STRESSED = /\b(stressed|stressful|deadline|anxious|overwhelmed|panic|panicking|too much|swamped|worried)\b/i;

/** First matching word in `text` for `re` that is not negated ("not good"). */
function sentiment(text) {
  const t = String(text || '');
  const pick = (re) => {
    const m = re.exec(t);
    if (!m) return null;
    return { negated: NEGATION.test(t.slice(0, m.index)) };
  };
  const pos = pick(POSITIVE);
  const neg = pick(NEGATIVE);
  let score = 0;
  if (pos) score += pos.negated ? -0.25 : 0.3;
  if (neg) score += neg.negated ? 0.15 : -0.3;
  return score;
}

export class MoodEngine {
  constructor({ now = Date.now, eventBus = null, halfLifeMs = 10 * MIN, hourOf } = {}) {
    this.now = now;
    this.eventBus = eventBus;
    this.halfLifeMs = halfLifeMs;
    this.hourOf = hourOf || ((t) => new Date(t).getHours());

    this.valence = 0;              // -1 (low) .. +1 (happy)
    this._valenceAt = now();
    this.failStreak = 0;
    this.lastSuccessAt = 0;
    this.lastCuriousAt = 0;
    this.excitedUntil = 0;

    this.userState = 'neutral';    // how Grace seems: neutral | tired | stressed | happy
    this.userStateAt = 0;

    this.lastActivityAt = now();
    this.workStartAt = now();
    this.lastCareAt = 0;

    this.label = 'neutral';
    this._timer = null;
  }

  // ── inputs ────────────────────────────────────────────────────────────────

  /** A task Rocky ran for Grace finished (ok) or failed. */
  onTaskResult(ok) {
    this._decay();
    if (ok) {
      this.failStreak = 0;
      this.lastSuccessAt = this.now();
      this._nudge(0.4);
      // A run of recent wins is exciting.
      this._wins = (this._wins || []).filter(t => this.now() - t < 5 * MIN).concat(this.now());
      if (this._wins.length >= 3) this.excitedUntil = this.now() + 2 * MIN;
    } else {
      this.failStreak++;
      this._nudge(-0.3 - Math.min(this.failStreak - 1, 2) * 0.15);
    }
    this._refresh();
  }

  /** Grace said something. Updates Rocky's feelings and reads how Grace seems. */
  onUserMessage(text) {
    const t = this.now();
    this._decay();
    if (t - this.lastActivityAt > 20 * MIN) this.workStartAt = t; // took a real break
    this.lastActivityAt = t;

    const s = sentiment(text);
    if (s) this._nudge(s);
    if (s >= 0.3 && /\b(amaze|amazing|awesome|brilliant|fantastic|yay)\b/i.test(text)) this.excitedUntil = t + 90 * 1000;

    if (TIRED.test(text)) this._setUserState('tired');
    else if (STRESSED.test(text)) this._setUserState('stressed');
    else if (s >= 0.3) this._setUserState('happy');
    this._refresh();
  }

  /** Rocky just asked Grace something he was curious about. */
  onQuestionAsked() {
    this.lastCuriousAt = this.now();
    this._refresh();
  }

  // ── outputs ───────────────────────────────────────────────────────────────

  /** Current mood: { label, valence, energy, userState }. */
  getMood() {
    this._decay();
    return { label: this._computeLabel(), valence: round(this.valence), energy: round(this._energy()), userState: this._currentUserState() };
  }

  /**
   * One short message if Grace seems to need care, otherwise null. Throttled to
   * one every 2 hours so it never nags. Call only when Grace is idle.
   */
  careMessage() {
    const t = this.now();
    if (t - this.lastCareAt < 120 * MIN) return null;
    const hour = this.hourOf(t);
    const late = hour >= 23 || hour < 5;
    const workedMs = t - this.workStartAt;
    const userState = this._currentUserState();

    let msg = null;
    if (userState === 'tired' || (late && workedMs > 30 * MIN)) {
      msg = late
        ? 'Grace… it is late. Grace is tired. Sleep is important. Rocky worry.'
        : 'Grace… Grace sound tired. Rest a little? Rocky stay here.';
    } else if (userState === 'stressed') {
      msg = 'Grace… much stress. Breathe slowly. Rocky help with one thing at a time.';
    } else if (workedMs > 2 * 60 * MIN) {
      msg = 'Grace… work long time without rest. Stand, drink water, then continue. Question: okay?';
    }
    if (msg) {
      this.lastCareAt = t;
      this.workStartAt = t; // count the next stretch from now
      if (userState !== 'neutral') this.userState = 'neutral';
    }
    return msg;
  }

  /** A line for the language model so the reply tone matches Rocky's mood. */
  moodHint() {
    const { label, userState } = this.getMood();
    const parts = [];
    const tone = {
      happy: 'Rocky feels happy and warm.',
      proud: 'Rocky feels proud that the last task worked.',
      excited: 'Rocky feels excited and lively.',
      curious: 'Rocky feels curious.',
      worried: 'Rocky feels a little worried because something just went wrong.',
      sleepy: 'Rocky feels sleepy and slow.',
    }[label];
    if (tone) parts.push(tone);
    if (userState === 'tired') parts.push('Grace seems tired; be gentle and brief.');
    if (userState === 'stressed') parts.push('Grace seems stressed; be calm and reassuring.');
    return parts.length ? `${parts.join(' ')} Let this colour your tone lightly; do not announce the mood.` : '';
  }

  /** Re-evaluate on a timer so decay, sleepiness and the clock are reflected. */
  start(intervalMs = MIN) {
    this.stop();
    this._timer = setInterval(() => this._refresh(), intervalMs);
    this._timer.unref?.();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  _nudge(delta) {
    this.valence = Math.max(-1, Math.min(1, this.valence + delta));
    this._valenceAt = this.now();
  }

  _decay() {
    const t = this.now();
    const dt = t - this._valenceAt;
    if (dt > 0) {
      this.valence *= Math.pow(0.5, dt / this.halfLifeMs);
      if (Math.abs(this.valence) < 0.01) this.valence = 0;
      this._valenceAt = t;
    }
  }

  _setUserState(state) {
    this.userState = state;
    this.userStateAt = this.now();
  }

  /** Grace's state counts for 30 minutes, then fades. */
  _currentUserState() {
    return this.now() - this.userStateAt < 30 * MIN ? this.userState : 'neutral';
  }

  _energy() {
    const t = this.now();
    const hour = this.hourOf(t);
    let e = hour >= 23 || hour < 5 ? 0.25 : hour < 7 ? 0.55 : 0.75;
    if (t - this.lastActivityAt > 30 * MIN) e -= 0.5; // left alone for a while: dozes off
    return Math.max(0, e);
  }

  _computeLabel() {
    const t = this.now();
    if (this.valence <= -0.3) return 'worried';
    if (t - this.lastSuccessAt < 2 * MIN && this.lastSuccessAt) return 'proud';
    if (t < this.excitedUntil) return 'excited';
    if (t - this.lastCuriousAt < MIN && this.lastCuriousAt) return 'curious';
    if (this.valence >= 0.3) return 'happy';
    if (this._energy() <= 0.3) return 'sleepy';
    return 'neutral';
  }

  _refresh() {
    this._decay();
    const label = this._computeLabel();
    if (label !== this.label) {
      this.label = label;
      this.eventBus?.emit('MOOD_CHANGE', this.getMood());
    }
  }
}

const round = (n) => Math.round(n * 100) / 100;

export default MoodEngine;
