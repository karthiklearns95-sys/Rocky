import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class VectorStore {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'vector');
    this.db = null;
    this.table = null;
    this.tableName = 'memories';
    this.embeddingModel = 'nomic-embed-text';
    this.ollamaUrl = 'http://localhost:11434/api/embeddings';
  }

  async init() {
    console.log(`[VectorStore] Initializing LanceDB at ${this.dbPath}...`);
    this.db = await lancedb.connect(this.dbPath);
    
    // Check if table exists
    const tables = await this.db.tableNames();
    if (!tables.includes(this.tableName)) {
      console.log(`[VectorStore] Creating new table: ${this.tableName}`);
      // We'll create it with the first insertion
    } else {
      this.table = await this.db.openTable(this.tableName);
    }
  }

  async getEmbedding(text) {
    try {
      const response = await fetch(this.ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text
        })
      });

      if (!response.ok) throw new Error(`Ollama embedding error: ${response.statusText}`);
      const data = await response.json();
      return data.embedding;
    } catch (error) {
      console.error('[VectorStore] Error getting embedding:', error);
      // Return a dummy vector if Ollama fails (unlikely if running)
      return new Array(768).fill(0); 
    }
  }

  async add(text, metadata = {}) {
    if (!this.db) await this.init();
    
    const vector = await this.getEmbedding(text);
    const data = [{
      vector,
      text,
      metadata: JSON.stringify(metadata),
      timestamp: Date.now()
    }];

    if (!this.table) {
      this.table = await this.db.createTable(this.tableName, data);
    } else {
      await this.table.add(data);
    }
    console.log(`[VectorStore] Memory added: "${text.substring(0, 30)}..."`);
  }

  async search(query, limit = 5) {
    if (!this.db) await this.init();
    if (!this.table) return [];

    const queryVector = await this.getEmbedding(query);
    const results = await this.table
      .vectorSearch(queryVector)
      .limit(limit)
      .toArray();

    return results.map(r => ({
      text: r.text,
      metadata: JSON.parse(r.metadata),
      score: r._distance,
      timestamp: r.timestamp
    }));
  }
}
