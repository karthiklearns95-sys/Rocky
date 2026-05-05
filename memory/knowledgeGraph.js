import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ ]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function escapeLike(value) {
  return `%${String(value || '').replace(/[%_]/g, '\\$&')}%`;
}

export default class KnowledgeGraph {
  constructor(dbPath = path.join(__dirname, '..', 'data', 'knowledge_graph.db')) {
    this.dbPath = dbPath;
    this.jsonPath = dbPath.replace(/\.db$/i, '.json');
    this.db = null;
    this.useFallback = false;
    this.data = { triples: [] };
    this.initPromise = this.init();
  }

  async init() {
    try {
      const Database = (await import('better-sqlite3')).default;
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      this.db = new Database(this.dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS triples (
          subject TEXT NOT NULL,
          relation TEXT NOT NULL,
          object TEXT NOT NULL,
          confidence REAL DEFAULT 1.0,
          source TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (subject, relation, object)
        );
        CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject);
        CREATE INDEX IF NOT EXISTS idx_triples_relation ON triples(relation);
        CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object);
      `);
      console.log('[KnowledgeGraph] SQLite graph initialized.');
    } catch (error) {
      console.warn('[KnowledgeGraph] SQLite unavailable, using JSON graph fallback:', error.message);
      this.useFallback = true;
      this._loadJson();
    }
  }

  _loadJson() {
    try {
      if (fs.existsSync(this.jsonPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8'));
        if (parsed && Array.isArray(parsed.triples)) this.data = parsed;
      }
    } catch (error) {
      console.warn('[KnowledgeGraph] Could not load JSON graph:', error.message);
      this.data = { triples: [] };
    }
  }

  _saveJson() {
    if (!this.useFallback) return;
    fs.mkdirSync(path.dirname(this.jsonPath), { recursive: true });
    fs.writeFileSync(this.jsonPath, JSON.stringify(this.data, null, 2));
  }

  async upsertFact({ subject, relation, object, confidence = 1.0, source = 'user' }) {
    await this.initPromise;
    const triple = {
      subject: normalize(subject || 'user'),
      relation: normalize(relation).replace(/\s+/g, '_'),
      object: String(object || '').trim(),
      confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
      source,
      updated_at: Date.now()
    };

    if (!triple.subject || !triple.relation || !triple.object || triple.confidence < 0.5) {
      return false;
    }

    if (this.useFallback) {
      const index = this.data.triples.findIndex((item) => (
        item.subject === triple.subject &&
        item.relation === triple.relation &&
        normalize(item.object) === normalize(triple.object)
      ));
      if (index >= 0) this.data.triples[index] = triple;
      else this.data.triples.push(triple);
      this._saveJson();
      return true;
    }

    const stmt = this.db.prepare(`
      INSERT INTO triples (subject, relation, object, confidence, source, updated_at)
      VALUES (@subject, @relation, @object, @confidence, @source, @updated_at)
      ON CONFLICT(subject, relation, object)
      DO UPDATE SET
        confidence = excluded.confidence,
        source = excluded.source,
        updated_at = excluded.updated_at
    `);
    stmt.run(triple);
    return true;
  }

  async saveFacts(facts = [], source = 'user') {
    const saved = [];
    for (const fact of facts) {
      const ok = await this.upsertFact({ ...fact, source });
      if (ok) saved.push(fact);
    }
    if (saved.length > 0) {
      console.log(`[KnowledgeGraph] Saved ${saved.length} fact triple(s).`);
    }
    return saved;
  }

  _scoreTriple(triple, query) {
    const q = normalize(query);
    const haystack = normalize(`${triple.subject} ${triple.relation} ${triple.object}`);
    if (!q) return 0;
    if (haystack.includes(q)) return 3;

    return q.split(/\s+/).filter((token) => token.length > 2 && haystack.includes(token)).length;
  }

  async search(query, limit = 8) {
    await this.initPromise;
    const q = normalize(query);
    if (!q) return [];

    if (this.useFallback) {
      return this.data.triples
        .map((triple) => ({ ...triple, _score: this._scoreTriple(triple, q) }))
        .filter((triple) => triple._score > 0 && triple.confidence >= 0.5)
        .sort((a, b) => b._score - a._score || b.confidence - a.confidence || b.updated_at - a.updated_at)
        .slice(0, limit);
    }

    const like = escapeLike(q);
    const rows = this.db.prepare(`
      SELECT * FROM triples
      WHERE confidence >= 0.5
        AND (
          subject LIKE @like ESCAPE '\\'
          OR relation LIKE @like ESCAPE '\\'
          OR object LIKE @like ESCAPE '\\'
        )
      ORDER BY confidence DESC, updated_at DESC
      LIMIT @limit
    `).all({ like, limit });

    if (rows.length > 0) return rows;

    const all = this.db.prepare('SELECT * FROM triples WHERE confidence >= 0.5').all();
    return all
      .map((triple) => ({ ...triple, _score: this._scoreTriple(triple, q) }))
      .filter((triple) => triple._score > 0)
      .sort((a, b) => b._score - a._score || b.confidence - a.confidence || b.updated_at - a.updated_at)
      .slice(0, limit);
  }

  async contextFor(query, limit = 8) {
    const triples = await this.search(query, limit);
    return triples.map((triple) => `${triple.subject} ${triple.relation} is ${triple.object}`);
  }
}
