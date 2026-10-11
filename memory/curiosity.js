/**
 * Curiosity - Rocky notices what he doesn't know about Grace and asks.
 *
 * Looks for gaps in the knowledge graph and turns the most useful one into a
 * single short question. Asking is paced so it never nags:
 *   - at most one question per `globalCooldownMs` (default 3 hours)
 *   - the same topic is not repeated for `topicCooldownMs` (default 7 days)
 *   - the next thing Grace says within `answerWindowMs` is treated as the answer
 *
 * Gaps, in priority order:
 *   1. confirm       - a fact Rocky only guessed (low confidence): "Is this true?"
 *   2. relationship  - a person Rocky knows the name of but not who they are to Grace
 *   3. profile       - basics Rocky has never been told (work, music, hobbies)
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const PROFILE_QUESTIONS = [
  { key: 'occupation', has: /^(works?_(on|at|as)|studies|study|occupation|job|major|profession)/,
    text: "Grace… question. What do you work on, or study? Rocky wants to understand." },
  { key: 'music', has: /(music|song|band|artist|playlist|genre)/,
    text: "Grace… question. What music do you like?" },
  { key: 'hobby', has: /(hobby|hobbies|interest|enjoys|plays|likes_to)/,
    text: "Grace… question. What do you do for fun?" },
  { key: 'routine', has: /(wakes?|sleeps?|routine|usually|schedule)/,
    text: "Grace… question. When do you usually work? Morning or night?" },
];

export const YES = /^\s*(yes|yeah|yep|yup|sure|correct|right|true|exactly|it is|that'?s right)\b/i;
export const NO = /^\s*(no|nope|nah|wrong|not really|incorrect|false|that'?s not)\b/i;

const words = (rel) => String(rel).replace(/_/g, ' ');

export default class Curiosity {
  constructor(graph, opts = {}) {
    this.graph = graph;
    this.now = opts.now || Date.now;
    this.globalCooldownMs = opts.globalCooldownMs ?? 3 * HOUR;
    this.topicCooldownMs = opts.topicCooldownMs ?? 7 * DAY;
    this.answerWindowMs = opts.answerWindowMs ?? 2 * 60 * 1000;
    this.pending = null; // { ...question, askedAt }
  }

  /** The best question to ask right now, or null (nothing to ask / too soon). */
  async nextQuestion() {
    await this.graph.init();
    if (!this.graph.isAvailable()) return null;
    const db = this.graph.db;
    const now = this.now();

    const last = db.prepare('SELECT MAX(asked_at) AS t FROM curiosity_log').get().t;
    if (last && now - last < this.globalCooldownMs) return null;

    const recentlyAsked = (key) => {
      const row = db.prepare('SELECT asked_at, answered FROM curiosity_log WHERE topic_key = ?').get(key);
      return !!row && (row.answered === 1 || now - row.asked_at < this.topicCooldownMs);
    };

    // 1. Facts Rocky only guessed (e.g. inferred during night reflection).
    const guess = db.prepare(`
      SELECT e.id, s.name AS subject, e.relation, o.name AS object
      FROM edges e JOIN entities s ON s.id = e.subject_id JOIN entities o ON o.id = e.object_id
      WHERE e.valid_to IS NULL AND e.confidence < 0.7
      ORDER BY e.last_seen DESC LIMIT 10`).all()
      .find(f => !recentlyAsked(`confirm:${f.id}`));
    if (guess) {
      const who = guess.subject.toLowerCase() === 'user' ? 'Grace' : guess.subject;
      return {
        key: `confirm:${guess.id}`, kind: 'confirm',
        fact: { subject: guess.subject, relation: guess.relation, object: guess.object },
        text: `Grace… Rocky think ${who} ${words(guess.relation)} ${guess.object}. Is this true?`,
      };
    }

    // 2. People Rocky has heard of but cannot place in Grace's life.
    const stranger = db.prepare(`
      SELECT p.id, p.name FROM entities p
      WHERE p.type = 'person' AND lower(p.name) != 'user'
        AND NOT EXISTS (
          SELECT 1 FROM edges e JOIN entities u ON u.name = 'user'
          WHERE e.valid_to IS NULL
            AND ((e.subject_id = u.id AND e.object_id = p.id) OR (e.object_id = u.id AND e.subject_id = p.id)))
      ORDER BY p.created_at DESC LIMIT 10`).all()
      .find(p => !recentlyAsked(`rel:${p.id}`));
    if (stranger) {
      return {
        key: `rel:${stranger.id}`, kind: 'relationship', subject: stranger.name,
        text: `Grace… question. Who is ${stranger.name} to you?`,
      };
    }

    // 3. Basics Rocky has never been told.
    const userRelations = db.prepare(`
      SELECT e.relation FROM edges e JOIN entities u ON u.id = e.subject_id
      WHERE u.name = 'user' AND e.valid_to IS NULL`).all().map(r => r.relation);
    const gap = PROFILE_QUESTIONS.find(q =>
      !userRelations.some(r => q.has.test(r)) && !recentlyAsked(`profile:${q.key}`));
    if (gap) return { key: `profile:${gap.key}`, kind: 'profile', text: gap.text };

    return null;
  }

  /** Record that a question was spoken; the next reply may be its answer. */
  markAsked(question) {
    if (!this.graph.isAvailable()) return;
    this.graph.db.prepare('INSERT OR REPLACE INTO curiosity_log (topic_key, asked_at, answered) VALUES (?, ?, 0)')
      .run(question.key, this.now());
    this.pending = { ...question, askedAt: this.now() };
  }

  /** Returns the question awaiting an answer (if still fresh) and clears it. */
  takePending() {
    const p = this.pending;
    this.pending = null;
    if (!p || this.now() - p.askedAt > this.answerWindowMs) return null;
    return p;
  }

  markAnswered(question) {
    if (!this.graph.isAvailable()) return;
    this.graph.db.prepare('UPDATE curiosity_log SET answered = 1 WHERE topic_key = ?').run(question.key);
  }

  /**
   * Handle a reply to a confirm question. Returns a spoken response when the
   * reply was a clear yes/no, otherwise null (treat it as a normal command).
   */
  async answerConfirm(question, reply) {
    if (question.kind !== 'confirm') return null;
    if (YES.test(reply)) {
      await this.graph.upsertFact({ ...question.fact, confidence: 0.95, source: 'confirmed' });
      this.markAnswered(question);
      return 'Grace… good. Rocky is sure now. Amaze.';
    }
    if (NO.test(reply)) {
      await this.graph.retireFact(question.fact);
      this.markAnswered(question);
      return 'Grace… Rocky was wrong. Rocky forgets it. Thank you.';
    }
    return null;
  }
}
