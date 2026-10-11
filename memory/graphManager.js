import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * GraphManager - Rocky's knowledge graph of the user's world.
 *
 * Stored in a single local SQLite file (no server to run). It is still a real
 * graph: entities are nodes, facts are typed edges, and questions can walk
 * several hops ("my brother's wife").
 *
 *   entities(id, name, type)             nodes, name unique case-insensitively
 *   aliases(alias -> entity)             the user's own words for things
 *   edges(subject, relation, object,     facts, each with confidence, source and
 *         confidence, valid_from/to)     a validity window, so "used to like X"
 *                                        is kept as history instead of deleted
 *
 * Degrades gracefully: if better-sqlite3 cannot load, isAvailable() is false and
 * every call returns an empty result instead of throwing.
 */

const USER = 'user';
const USER_WORDS = new Set(['i', 'me', 'my', 'myself', 'user', 'mine']);

// A person has one value for these at a time; a new value retires the old edge.
const EXCLUSIVE = /^(favou?rite_.*|preferred_.*|lives_in|works_at|name|age|birthday|crush|mood)$/;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'from', 'you', 'can', 'get',
  'put', 'open', 'send', 'what', 'who', 'where', 'when', 'how', 'was', 'are', 'about',
]);

export function normalizeRelation(relation) {
  return String(relation).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export class GraphManager {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '..', 'data', 'knowledge_graph.db');
    this.db = null;
    this.available = false;
    this._initPromise = null;
  }

  /** Opens the database once. Safe to call repeatedly. */
  init() {
    if (!this._initPromise) this._initPromise = this._open();
    return this._initPromise;
  }

  async _open() {
    try {
      if (this.dbPath !== ':memory:') fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS entities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          type TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS aliases (
          alias TEXT PRIMARY KEY COLLATE NOCASE,
          entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          subject_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          relation TEXT NOT NULL,
          object_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          confidence REAL NOT NULL DEFAULT 0.8,
          source TEXT,
          valid_from INTEGER NOT NULL,
          valid_to INTEGER,
          last_seen INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS edges_active_uq
          ON edges(subject_id, relation, object_id) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS edges_subject ON edges(subject_id) WHERE valid_to IS NULL;
        CREATE INDEX IF NOT EXISTS edges_object ON edges(object_id) WHERE valid_to IS NULL;
      `);
      this.available = true;
      console.log('[GraphManager] ✅ Knowledge graph ready (SQLite).');
    } catch (e) {
      this.available = false;
      console.warn(`[GraphManager] ⚠️  Knowledge graph disabled: ${e.message}`);
    }
  }

  /** True once the database is open. */
  isAvailable() {
    return this.available;
  }

  close() {
    try { this.db?.close(); } catch { /* already closed */ }
    this.available = false;
  }

  _canonical(name) {
    const n = String(name ?? '').trim();
    return USER_WORDS.has(n.toLowerCase()) ? USER : n;
  }

  /** Returns the entity id for a name or alias, creating the entity if needed. */
  _entityId(name, type = null) {
    const clean = this._canonical(name);
    const viaAlias = this.db.prepare('SELECT entity_id FROM aliases WHERE alias = ?').get(clean);
    if (viaAlias) return viaAlias.entity_id;
    const existing = this.db.prepare('SELECT id, type FROM entities WHERE name = ?').get(clean);
    if (existing) {
      if (type && !existing.type) this.db.prepare('UPDATE entities SET type = ? WHERE id = ?').run(type, existing.id);
      return existing.id;
    }
    return this.db.prepare('INSERT INTO entities (name, type, created_at) VALUES (?, ?, ?)')
      .run(clean, type, Date.now()).lastInsertRowid;
  }

  /**
   * Record that `alias` is the user's own word for `entity`
   * ("my playlist" -> "Chill Mix"). Later lookups by either name find the same node.
   */
  addAlias(alias, entity) {
    if (!this.available || !alias || !entity) return false;
    const id = this._entityId(entity);
    this.db.prepare('INSERT OR REPLACE INTO aliases (alias, entity_id) VALUES (?, ?)').run(String(alias).trim(), id);
    return true;
  }

  /**
   * Store a fact. Re-stating a known fact refreshes it; a new value for an
   * exclusive relation (favorite_color, lives_in...) retires the old one.
   */
  async upsertFact({ subject, relation, object, confidence = 0.8, source = 'user', subjectType = null, objectType = null }) {
    await this.init();
    if (!this.available || !subject || !relation || !object) return false;
    const rel = normalizeRelation(relation);
    if (!rel) return false;

    const now = Date.now();
    try {
      this.db.transaction(() => {
        const s = this._entityId(subject, subjectType);
        const o = this._entityId(object, objectType);
        if (EXCLUSIVE.test(rel)) {
          this.db.prepare(
            'UPDATE edges SET valid_to = ? WHERE subject_id = ? AND relation = ? AND object_id != ? AND valid_to IS NULL'
          ).run(now, s, rel, o);
        }
        const active = this.db.prepare(
          'SELECT id, confidence FROM edges WHERE subject_id = ? AND relation = ? AND object_id = ? AND valid_to IS NULL'
        ).get(s, rel, o);
        if (active) {
          this.db.prepare('UPDATE edges SET confidence = ?, last_seen = ?, source = ? WHERE id = ?')
            .run(Math.max(active.confidence, confidence), now, source, active.id);
        } else {
          this.db.prepare(
            'INSERT INTO edges (subject_id, relation, object_id, confidence, source, valid_from, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(s, rel, o, confidence, source, now, now);
        }
      })();
      return true;
    } catch (e) {
      console.warn('[GraphManager] Failed to upsert fact:', e.message);
      return false;
    }
  }

  /** Batch save; returns the facts that were stored. */
  async saveFacts(facts = [], source = 'user') {
    const saved = [];
    for (const fact of facts) {
      if (await this.upsertFact({ ...fact, source })) saved.push(fact);
    }
    if (saved.length > 0) console.log(`[GraphManager] Saved ${saved.length} fact(s) to the knowledge graph.`);
    return saved;
  }

  /** Mark a fact as no longer true (kept as history). */
  async retireFact({ subject, relation, object }) {
    await this.init();
    if (!this.available) return false;
    const rel = normalizeRelation(relation);
    const info = this.db.prepare(`
      UPDATE edges SET valid_to = ?
      WHERE valid_to IS NULL AND relation = ?
        AND subject_id = (SELECT id FROM entities WHERE name = ?)
        AND object_id = (SELECT id FROM entities WHERE name = ?)
    `).run(Date.now(), rel, this._canonical(subject), this._canonical(object));
    return info.changes > 0;
  }

  /** Entities (by name or alias) mentioned in free text. */
  _mentionedEntityIds(text) {
    const lower = ` ${String(text).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ')} `;
    const ids = new Set();
    const rows = this.db.prepare(`
      SELECT id, name AS label FROM entities
      UNION ALL
      SELECT entity_id AS id, alias AS label FROM aliases
    `).all();
    for (const { id, label } of rows) {
      const l = label.toLowerCase();
      if (l === USER) continue;
      if (l.length < 3 || STOP_WORDS.has(l)) continue;
      if (lower.includes(` ${l} `)) ids.add(id);
    }
    // First-person talk is about the user node.
    if (/\b(my|me|mine|myself|i|i'm|i am)\b/.test(lower)) {
      const u = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(USER);
      if (u) ids.add(u.id);
    }
    return [...ids];
  }

  /**
   * Walk the active graph outward from `startIds` up to `depth` hops and return
   * facts as { subject, relation, object, confidence, hops }.
   */
  _neighborhood(startIds, depth = 2, limit = 8) {
    const seenEntities = new Set(startIds);
    const seenEdges = new Set();
    const facts = [];
    let frontier = [...startIds];
    const stmt = this.db.prepare(`
      SELECT e.id AS edge_id, s.id AS sid, s.name AS subject, e.relation, o.id AS oid, o.name AS object, e.confidence
      FROM edges e
      JOIN entities s ON s.id = e.subject_id
      JOIN entities o ON o.id = e.object_id
      WHERE e.valid_to IS NULL AND (e.subject_id = ? OR e.object_id = ?)
      ORDER BY e.confidence DESC, e.last_seen DESC
    `);
    for (let hop = 1; hop <= depth && frontier.length > 0; hop++) {
      const next = [];
      for (const id of frontier) {
        for (const r of stmt.all(id, id)) {
          if (seenEdges.has(r.edge_id)) continue;
          seenEdges.add(r.edge_id);
          facts.push({ subject: r.subject, relation: r.relation, object: r.object, confidence: r.confidence, hops: hop });
          for (const other of [r.sid, r.oid]) {
            if (!seenEntities.has(other)) { seenEntities.add(other); next.push(other); }
          }
        }
      }
      frontier = next;
    }
    return facts.sort((a, b) => a.hops - b.hops || b.confidence - a.confidence).slice(0, limit);
  }

  /** Facts about everything the text mentions, up to 2 hops away. */
  async queryFacts(userInput, { depth = 2, limit = 8 } = {}) {
    await this.init();
    if (!this.available || !userInput) return [];
    try {
      const ids = this._mentionedEntityIds(userInput);
      return ids.length ? this._neighborhood(ids, depth, limit) : [];
    } catch (e) {
      console.warn('[GraphManager] Query failed:', e.message);
      return [];
    }
  }

  /** Prompt-ready text: one "a -[relation]-> b" line per fact, '' if nothing known. */
  async getEntityContext(userInput) {
    const facts = await this.queryFacts(userInput);
    return facts.map(f => `${f.subject} -[${f.relation}]-> ${f.object}`).join('\n');
  }
}

export const graphManager = new GraphManager();
