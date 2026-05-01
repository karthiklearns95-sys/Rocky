export default class ContextLoader {
  constructor(memoryManager) {
    this.memoryManager = memoryManager; // To be implemented in Phase 6
  }

  async load(intentResult) {
    console.log(`[ContextLoader] Loading context for intent: ${intentResult.intent}`);
    
    // Perform semantic search to find relevant past interactions
    const memories = await this.memoryManager.recall(intentResult.intent || "general conversation", 5);
    const recentHistory = memories.map(m => m.text);
    
    return {
      userName: "Grace",
      time: new Date().toISOString(),
      recentHistory: recentHistory
    };
  }
}
