import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * RelationalStore: Manages structured data (tasks, settings, logs).
 * FALLBACK: Uses a JSON file if better-sqlite3 fails to load (common in Electron).
 */
export default class RelationalStore {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '..', 'data', 'rocky.db');
    this.jsonPath = this.dbPath.replace('.db', '.json');
    this.db = null;
    this.useFallback = false;
    this.data = {
      tasks: [],
      settings: {},
      activity_logs: []
    };
  }

  async init() {
    try {
      // Try to load native SQLite
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(this.dbPath);
      this._createTables();
      console.log('[RelationalStore] SQLite initialized.');
    } catch (error) {
      console.warn('[RelationalStore] Native SQLite failed, switching to JSON fallback:', error.message);
      this.useFallback = true;
      this._loadJson();
    }
  }

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  _loadJson() {
    if (fs.existsSync(this.jsonPath)) {
      try {
        const raw = fs.readFileSync(this.jsonPath, 'utf8');
        this.data = JSON.parse(raw);
      } catch (e) {
        console.error('[RelationalStore] Failed to load JSON fallback data.');
      }
    }
  }

  _saveJson() {
    if (this.useFallback) {
      fs.writeFileSync(this.jsonPath, JSON.stringify(this.data, null, 2));
    }
  }

  // --- Task methods ---
  addTask(title) {
    if (this.useFallback) {
      const id = Date.now();
      this.data.tasks.push({ id, title, status: 'pending', created_at: new Date().toISOString() });
      this._saveJson();
      return id;
    }
    const stmt = this.db.prepare('INSERT INTO tasks (title) VALUES (?)');
    return stmt.run(title).lastInsertRowid;
  }

  getTasks(status = null) {
    if (this.useFallback) {
      if (status) return this.data.tasks.filter(t => t.status === status);
      return [...this.data.tasks].reverse();
    }
    if (status) {
      return this.db.prepare('SELECT * FROM tasks WHERE status = ?').all(status);
    }
    return this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  }

  // --- Settings methods ---
  setSetting(key, value) {
    if (this.useFallback) {
      this.data.settings[key] = value;
      this._saveJson();
      return;
    }
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(key, JSON.stringify(value));
  }

  getSetting(key) {
    if (this.useFallback) {
      return this.data.settings[key] || null;
    }
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key);
    return row ? JSON.parse(row.value) : null;
  }

  // --- Logging ---
  logActivity(event, details = '') {
    if (this.useFallback) {
      this.data.activity_logs.push({ event, details, timestamp: new Date().toISOString() });
      this._saveJson();
      return;
    }
    const stmt = this.db.prepare('INSERT INTO activity_logs (event, details) VALUES (?, ?)');
    stmt.run(event, details);
  }
}
