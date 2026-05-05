import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'rocky_memory.db');

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);

  // Ensure schema exists
  _db.exec(`
    CREATE TABLE IF NOT EXISTS user_facts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      subject   TEXT NOT NULL,
      relation  TEXT NOT NULL,
      object    TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      timestamp TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subject_relation ON user_facts(subject, relation);
  `);

  return _db;
}

/**
 * Persist extracted facts. Overwrites existing relation for the same subject
 * so "my crush is now Ananya" replaces the old entry for subject=user, relation=crush.
 */
export async function saveFacts(facts) {
  if (!facts || !facts.relations || facts.relations.length === 0) return;

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO user_facts (subject, relation, object, confidence)
    VALUES (@subject, @relation, @object, @confidence)
    ON CONFLICT(subject, relation)
    DO UPDATE SET object = @object, confidence = @confidence, timestamp = datetime('now')
  `);

  const insertMany = db.transaction((relations) => {
    for (const rel of relations) {
      if (rel.subject && rel.relation && rel.object) {
        upsert.run({
          subject: rel.subject.toLowerCase().trim(),
          relation: rel.relation.toLowerCase().trim(),
          object: rel.object.trim(),
          confidence: rel.confidence || 1.0
        });
      }
    }
  });

  insertMany(facts.relations);
}

/**
 * Query facts relevant to the user's current input.
 * Matches against known relations using keyword extraction from the query.
 */
export async function queryFacts(query) {
  if (!query) return [];

  const db = getDb();
  const lower = query.toLowerCase();

  // Map query keywords → relation names
  const RELATION_KEYWORDS = {
    crush: ['crush', 'like', 'love', 'who do i like', 'who is my crush'],
    friend: ['friend', 'best friend', 'who is my friend'],
    occupation: ['job', 'work', 'career', 'what do i do'],
    name: ['my name', 'what is my name', 'called']
  };

  const matchedRelations = [];
  for (const [relation, keywords] of Object.entries(RELATION_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matchedRelations.push(relation);
    }
  }

  if (matchedRelations.length === 0) {
    // Return all user facts as general context
    return db.prepare(`SELECT * FROM user_facts WHERE subject = 'user' ORDER BY timestamp DESC LIMIT 10`).all();
  }

  const placeholders = matchedRelations.map(() => '?').join(', ');
  return db.prepare(
    `SELECT * FROM user_facts WHERE subject = 'user' AND relation IN (${placeholders})`
  ).all(...matchedRelations);
}

/**
 * Get all stored facts for debugging/display.
 */
export function getAllFacts() {
  return getDb().prepare('SELECT * FROM user_facts ORDER BY timestamp DESC').all();
}
