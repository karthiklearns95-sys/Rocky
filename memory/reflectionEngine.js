import RelationalStore from './relational/relationalStore.js';
import { graphManager } from './graphManager.js';
import LocalProvider from '../brain/aiProvider/localProvider.js';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/app.config.js';

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
        this.aiProvider = new LocalProvider(config.models.reflection);
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

        // 2. Structured Batch Analysis via Local LLM (schema-enforced JSON)
        const schema = {
            type: 'object',
            properties: {
                relationships: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            source: { type: 'string' },
                            relationship: { type: 'string' },
                            target: { type: 'string' }
                        },
                        required: ['source', 'relationship', 'target']
                    }
                }
            },
            required: ['relationships']
        };
        const prompt = `
You are an AI Memory Architect. Given this log of human behavior, extract implicit long-term relationships, human habits, and cross-application connections.
Use "user" as the source for facts about the person.

Behavior Logs:
${logContext}
`;

        try {
            const result = await this.aiProvider.generateStructured(prompt, schema);
            const relationships = Array.isArray(result?.relationships) ? result.relationships : [];
            if (relationships.length === 0) return;

            console.log(`[ReflectionEngine] 🧬 Synthesized ${relationships.length} new structural relationships.`);

            // 3. Store them in the knowledge graph (lower confidence: inferred, not stated)
            const saved = await graphManager.saveFacts(
                relationships.map(r => ({ subject: r.source, relation: r.relationship, object: r.target, confidence: 0.6 })),
                'reflection'
            );
            console.log(`[ReflectionEngine] 🧠 Knowledge Graph updated with ${saved.length} reflection fact(s).`);
        } catch (e) {
            console.error('[ReflectionEngine] Reflection execution failed:', e.message);
        }
    }
}

export const reflectionEngine = new ReflectionEngine();
