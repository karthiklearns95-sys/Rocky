import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class RelationalStore {
  constructor() {
    const dbDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    
    this.dbPath = path.join(dbDir, 'rocky.db');
    this.db = null;
  }

  init() {
    console.log(`[RelationalStore] Initializing SQLite at ${this.dbPath}...`);
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    // Create tables for structured data
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // Task methods
  addTask(title) {
    const stmt = this.db.prepare('INSERT INTO tasks (title) VALUES (?)');
    return stmt.run(title).lastInsertRowid;
  }

  getTasks(status = null) {
    if (status) {
      return this.db.prepare('SELECT * FROM tasks WHERE status = ?').all(status);
    }
    return this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  }

  // Settings methods
  setSetting(key, value) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(key, JSON.stringify(value));
  }

  getSetting(key) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key);
    return row ? JSON.parse(row.value) : null;
  }

  // Logging
  logActivity(event, details = '') {
    const stmt = this.db.prepare('INSERT INTO activity_logs (event, details) VALUES (?, ?)');
    stmt.run(event, details);
  }
}
