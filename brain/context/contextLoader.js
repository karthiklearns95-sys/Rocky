export default class ContextLoader {
  constructor(memoryManager) {
    this.memoryManager = memoryManager; // To be implemented in Phase 6
  }

  async load(intentResult) {
    console.log(`[ContextLoader] Loading context for intent: ${intentResult.intent}`);
    
    // In future, query VectorDB/SQLite based on intent and user
    const recentHistory = []; // e.g., memoryManager.retrieve(intentResult.intent)
    
    return {
      userName: "Grace",
      time: new Date().toISOString(),
      recentHistory: recentHistory
    };
  }
}
