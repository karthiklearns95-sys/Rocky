import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class UserMemory {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
    this.dbPath = path.join(__dirname, '..', 'data', 'lancedb');
    this.db = null;
    this.memoryTable = null;
    this.initPromise = this.init();
  }

  async init() {
    try {
      this.db = await lancedb.connect(this.dbPath);
      
      // We will create an empty table with a dummy schema if it doesn't exist.
      // But it's cleaner in LanceDB to just let it infer schema on first insert,
      // or open if exists.
      const tableNames = await this.db.tableNames();
      if (tableNames.includes('memory')) {
        this.memoryTable = await this.db.openTable('memory');
      }
      
      console.log(`[UserMemory] LanceDB Initialized at ${this.dbPath}`);
    } catch (e) {
      console.error(`[UserMemory] Init error:`, e.message);
    }
  }

  _generateId(content) {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  async saveMemory({ type, content, confidence = 1.0 }) {
    await this.initPromise;
    if (!this.db) return;
    
    // Embed the content asynchronously (max latency 200-1000ms)
    const vector = await this.aiProvider.embed(content);
    if (!vector) return;

    const id = `${type}_${this._generateId(content)}`;

    const row = {
      id,
      vector,
      content,
      type,
      confidence,
      timestamp: Date.now()
    };

    try {
      if (!this.memoryTable) {
        this.memoryTable = await this.db.createTable('memory', [row]);
      } else {
        // Overwrite if exists to update timestamp/confidence
        // LanceDB doesn't have an easy UPSERT out of the box for JS without passing mode='overwrite' for the whole table,
        // so we'll just add it. If we wanted strict dedup we'd delete the old id first.
        try {
          await this.memoryTable.delete(`id = '${id}'`);
        } catch(e) {} // ignore if not found
        await this.memoryTable.add([row]);
      }
      console.log(`[UserMemory] Saved ${type} memory.`);
    } catch (e) {
      console.error(`[UserMemory] Save error:`, e.message);
    }
  }

  async retrieveRelevantContext(query, limit = 3) {
    await this.initPromise;
    if (!this.memoryTable) return { facts: [], workflows: [] };

    const vector = await this.aiProvider.embed(query);
    if (!vector) return { facts: [], workflows: [] };

    try {
      const results = await this.memoryTable
        .search(vector)
        .limit(limit * 2) 
        .execute();

      const facts = [];
      const workflows = [];

      for (const res of results) {
        if (res.confidence < 0.5) continue;
        
        if (res.type === 'fact' && facts.length < limit) {
          facts.push(res.content);
        } else if (res.type === 'workflow' && workflows.length < limit) {
          workflows.push(res.content);
        }
      }

      return { facts, workflows };
    } catch (e) {
      console.error(`[UserMemory] Retrieval error:`, e.message);
      return { facts: [], workflows: [] };
    }
  }

  async adjustConfidence(content, delta) {
    await this.initPromise;
    if (!this.memoryTable) return;
    
    try {
      const id = `workflow_${this._generateId(content)}`;
      const results = await this.memoryTable.search(Array(384).fill(0)).where(`id = '${id}'`).limit(1).execute();
      
      if (results && results.length > 0) {
        const entry = results[0];
        const newConfidence = Math.max(0, Math.min(1.0, entry.confidence + delta));
        
        await this.memoryTable.delete(`id = '${id}'`);
        
        // Only re-add if confidence hasn't completely decayed
        if (newConfidence > 0) {
          entry.confidence = newConfidence;
          await this.memoryTable.add([entry]);
          console.log(`[UserMemory] Adjusted confidence of workflow to ${newConfidence}`);
        } else {
          console.log(`[UserMemory] Workflow decayed and removed from memory.`);
        }
      }
    } catch(e) {
      console.error(`[UserMemory] adjustConfidence error:`, e.message);
    }
  }
}
