import VectorStore from '../vector/vectorStore.js';
import RelationalStore from '../relational/relationalStore.js';

export default class MemoryManager {
  constructor() {
    this.vectorStore = new VectorStore();
    this.relationalStore = new RelationalStore();
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;
    
    console.log('[MemoryManager] Initializing hybrid memory system...');
    try {
      await this.vectorStore.init();
      this.relationalStore.init();
      this.isInitialized = true;
      console.log('[MemoryManager] Hybrid memory system READY.');
    } catch (error) {
      console.error('[MemoryManager] Initialization failed:', error);
    }
  }

  // --- Semantic Memory (Conversations / Context) ---
  
  async remember(text, tags = []) {
    try {
      await this.init();
      await this.vectorStore.add(text, { tags });
      this.relationalStore.logActivity('memory_stored', text.substring(0, 50));
    } catch (error) {
      console.error('[MemoryManager] Failed to store memory:', error.message);
    }
  }

  async recall(query, limit = 3) {
    await this.init();
    return await this.vectorStore.search(query, limit);
  }

  // --- Structured Memory (Tasks / Settings) ---

  async addTask(title) {
    await this.init();
    const id = this.relationalStore.addTask(title);
    this.relationalStore.logActivity('task_added', title);
    return id;
  }

  async getTasks() {
    await this.init();
    return this.relationalStore.getTasks();
  }

  async setSetting(key, value) {
    await this.init();
    this.relationalStore.setSetting(key, value);
  }

  async getSetting(key) {
    await this.init();
    return this.relationalStore.getSetting(key);
  }
}
