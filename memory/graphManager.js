import neo4j from 'neo4j-driver';

/**
 * GraphManager
 * Provides strict Depth 1 relational queries against the Neo4j Knowledge Graph.
 * Completely wrapped in failsafes to guarantee zero impact on runtime stability.
 */
class GraphManager {
  constructor() {
    this.driver = null;
    this.init();
  }

  init() {
    try {
      // Initialize Neo4j driver (assuming default local bolt setup for Rocky)
      this.driver = neo4j.driver(
        'bolt://localhost:7687',
        neo4j.auth.basic('neo4j', 'password')
      );
    } catch (e) {
      console.warn('[GraphManager] Neo4j Driver init failed:', e.message);
    }
  }

  /**
   * Fast, lightweight entity extraction using basic heuristics.
   * Extracts capitalized proper nouns and known domain apps.
   */
  _extractEntities(text) {
    const entities = new Set();
    const words = text.toLowerCase().split(/\s+/);
    
    // Fast dictionary mapping to bypass fragile regex capitalization matching
    const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'have', 'from', 'you', 'can', 'get', 'put', 'open', 'send']);
    
    for (const w of words) {
        const clean = w.replace(/[^a-z0-9]/g, '');
        // Extract meaningful tokens > 2 chars that aren't stop words
        if (clean.length > 2 && !stopWords.has(clean)) {
            entities.add(clean);
        }
    }
    
    return Array.from(entities);
  }

  /**
   * Performs a strictly bound Depth 1 relational query for extracted entities.
   * Hard timeout at 500ms to guarantee zero runtime latency spikes.
   */
  async getEntityContext(userInput) {
    if (!this.driver || !userInput) return '';

    const entities = this._extractEntities(userInput);
    if (entities.length === 0) return '';

    let session;
    try {
      session = this.driver.session();
    } catch (e) {
      return '';
    }
    
    try {
      // Shallow Depth 1 Query
      const queryPromise = session.run(`
        MATCH (e)-[r]-(neighbor) 
        WHERE toLower(e.name) IN $entities 
        RETURN e.name AS subject, type(r) AS relation, neighbor.name AS object 
        LIMIT 5
      `, { entities });

      // 500ms Failsafe execution guard
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Neo4j Query Timeout (>500ms)')), 500)
      );

      const result = await Promise.race([queryPromise, timeoutPromise]);
      
      if (!result.records || result.records.length === 0) return '';

      const relationships = result.records.map(record => {
         return `${record.get('subject')} -[${record.get('relation')}]-> ${record.get('object')}`;
      });

      return relationships.join('\n');
    } catch (e) {
      // Silently swallow timeouts or graph connection drops to protect the main agent loop
      if (e.message && e.message.includes('Timeout')) {
          console.warn(`[GraphManager] Failsafe triggered: Neo4j query exceeded 500ms.`);
      }
      return '';
    } finally {
      await session.close().catch(() => {});
    }
  }
}

export const graphManager = new GraphManager();
