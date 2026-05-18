import RelationalStore from './relational/relationalStore.js';
import { graphManager } from './graphManager.js';
import LocalProvider from '../brain/aiProvider/localProvider.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'data', 'rocky.db');

/**
 * Autonomic Self-Reflection Pipeline
 * Runs in the background to distill human habits and interactions
 * into permanent long-term memory structures (Neo4j Graph).
 */
export class ReflectionEngine {
    constructor() {
        this.relationalDb = new RelationalStore(dbPath);
        this.relationalDb.init();
        this.aiProvider = new LocalProvider('mistral');
    }

    async executeSelfReflection() {
        console.log('[ReflectionEngine] 🌙 Initiating Autonomic Self-Reflection Pipeline...');
        
        // 1. Query the last 100 historical logs
        let logs = [];
        try {
            if (this.relationalDb.db && !this.relationalDb.useFallback) {
                logs = this.relationalDb.db.prepare(`
                    SELECT timestamp, event, details 
                    FROM activity_logs 
                    WHERE event = 'chat' OR event = 'user_input' OR event = 'automation'
                    ORDER BY timestamp DESC 
                    LIMIT 100
                `).all();
            }
        } catch (e) {
            console.error('[ReflectionEngine] Failed to read SQLite logs:', e.message);
            return;
        }

        if (logs.length === 0) {
            console.log('[ReflectionEngine] Not enough logs for reflection.');
            return;
        }

        const logContext = logs.map(l => `[${l.timestamp}] ${l.event}: ${l.details}`).join('\n');

        // 2. Structured Batch Analysis via Local LLM
        const prompt = `
You are an AI Memory Architect. Given this log of human behavior, extract implicit long-term relationships, human habits, and cross-application connections. 
Format your output strictly as a JSON array of objects with the structure:
[{"source": "Entity1", "relationship": "RELATION_NAME", "target": "Entity2"}]
Do not include any markdown formatting, only pure JSON.

Behavior Logs:
${logContext}
`;

        try {
            const rawResponse = await this.aiProvider.generate(prompt);
            let jsonMatch = rawResponse.match(/\[.*\]/s);
            let jsonString = jsonMatch ? jsonMatch[0] : rawResponse.trim();
            
            let relationships = [];
            try {
                relationships = JSON.parse(jsonString);
            } catch {
                console.error('[ReflectionEngine] Failed to parse LLM JSON output.');
                return;
            }

            if (!Array.isArray(relationships) || relationships.length === 0) return;
            
            console.log(`[ReflectionEngine] 🧬 Synthesized ${relationships.length} new structural relationships.`);

            // 3. Inject relationships into Neo4j using safe MERGE operations
            if (!graphManager.driver) {
                console.warn('[ReflectionEngine] Neo4j Driver not available.');
                return;
            }
            
            const session = graphManager.driver.session();
            try {
                for (const rel of relationships) {
                    if (!rel.source || !rel.relationship || !rel.target) continue;
                    
                    const safeRelName = rel.relationship.toUpperCase().replace(/[^A-Z_]/g, '_');
                    
                    const cypher = `
                        MERGE (s:Entity {name: toLower($source)})
                        MERGE (t:Entity {name: toLower($target)})
                        MERGE (s)-[r:\`${safeRelName}\`]->(t)
                        RETURN id(r)
                    `;
                    
                    await session.run(cypher, { 
                        source: rel.source.toString(), 
                        target: rel.target.toString() 
                    });
                }
                console.log('[ReflectionEngine] 🧠 Knowledge Graph successfully updated with reflection data.');
            } finally {
                await session.close().catch(() => {});
            }

        } catch (e) {
            console.error('[ReflectionEngine] Reflection execution failed:', e.message);
        }
    }
}

export const reflectionEngine = new ReflectionEngine();
