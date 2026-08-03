import neo4j from 'neo4j-driver';

/**
 * GraphManager
 * Provides relational queries against the Neo4j Knowledge Graph.
 *
 * Neo4j is OPTIONAL. If it is not running, this module degrades gracefully:
 * - Exactly one startup warning is emitted via verifyConnectivity().
 * - All query/write calls return empty/false immediately when unavailable.
 * - Call graphManager.isAvailable() to check health programmatically.
 */
class GraphManager {
  constructor() {
    this.driver = null;
    this.available = false;
    this.init();
  }

  init() {
    try {
      this.driver = neo4j.driver(
        'bolt://localhost:7687',
        neo4j.auth.basic('neo4j', 'password')
      );
      // Non-blocking connectivity check — sets availability once resolved
      this.driver.verifyConnectivity()
        .then(() => {
          this.available = true;
          console.log('[GraphManager] \u2705 Neo4j connected and available.');
        })
        .catch((e) => {
          this.available = false;
          console.warn(`[GraphManager] \u26a0\ufe0f  Neo4j not reachable \u2014 knowledge graph disabled. Start Neo4j to enable. (${e.message})`);
        });
    } catch (e) {
      this.available = false;
      console.warn(`[GraphManager] \u26a0\ufe0f  Neo4j driver init failed \u2014 knowledge graph disabled. (${e.message})`);
    }
  }

  /** Returns true only when Neo4j is confirmed reachable. */
  isAvailable() {
    return this.available;
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
    if (!this.available || !userInput) return '';

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

  /**
   * Upsert a fact triple into the Neo4j Knowledge Graph.
   * Creates nodes if they don't exist and links them with the relation.
   */
  async upsertFact({ subject, relation, object, source = 'user' }) {
    if (!this.available) return false;
    
    if (!subject || !relation || !object) return false;

    // Clean up relation name to be a valid Neo4j relationship type (e.g., LIKES, IS_A)
    const relType = relation.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    
    let session;
    try {
      session = this.driver.session();
    } catch (e) {
      console.warn(`[GraphManager] Failed to open session for upsertFact:`, e.message);
      return false;
    }

    try {
      // MERGE nodes to ensure uniqueness by name
      // MERGE relationship between them
      await session.run(`
        MERGE (s:Entity {name: $subject})
        MERGE (o:Entity {name: $object})
        MERGE (s)-[r:${relType}]->(o)
        SET r.source = $source, r.updated_at = timestamp()
        RETURN s, r, o
      `, {
        subject: subject.trim(),
        object: object.trim(),
        source: source
      });
      
      console.log(`[GraphManager] 🧠 Wrote to Neo4j: (${subject}) -[${relType}]-> (${object})`);
      return true;
    } catch (e) {
      console.warn(`[GraphManager] Failed to upsert fact into Neo4j:`, e.message);
      return false;
    } finally {
      await session.close().catch(() => {});
    }
  }

  /**
   * Batch save facts to the graph.
   */
  async saveFacts(facts = [], source = 'user') {
    const saved = [];
    for (const fact of facts) {
      const ok = await this.upsertFact({ ...fact, source });
      if (ok) saved.push(fact);
    }
    if (saved.length > 0) {
      console.log(`[GraphManager] Successfully saved ${saved.length} fact triple(s) to Neo4j.`);
    }
    return saved;
  }
}

export const graphManager = new GraphManager();
