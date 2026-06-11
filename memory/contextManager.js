import getActiveWindow from '../automation/system/getActiveWindow.js';
import UserMemory from './userMemory.js';
import RelationalStore from './relational/relationalStore.js';
import { graphManager } from './graphManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'rocky.db');
const relationalDb = new RelationalStore(dbPath);
relationalDb.init(); 

/**
 * Strict Data Bouncer for the LLM Planner.
 * Constructs a bounded, deterministic snapshot of the world state,
 * eliminating infinite token bloat from naive chat histories.
 */
export async function buildPlannerContext(userInput, sessionId, aiProvider) {
    
    // We execute Active State, Vector Context, SQLite, and Graph Context in parallel 
    // to completely hide the latency of multi-db querying.
    const [activeState, vectorContext, sqliteContext, graphContext] = await Promise.all([
        // 1. ACTIVE STATE (Via UIA IPC & System OS)
        (async () => {
            let activeWindow = 'Unknown';
            let focusState = 'Unknown (Idle)';
            try {
                const win = await getActiveWindow();
                activeWindow = win?.title || 'Unknown';
                
                focusState = 'Native Mode Active (UIA Disabled)';
            } catch (e) {
                console.warn('[ContextManager] Failed to fetch active state:', e.message);
            }
            return { activeWindow, focusState };
        })(),

        // 2. VECTOR CONTEXT (LanceDB via UserMemory)
        (async () => {
            let topWorkflow = 'None';
            try {
                if (aiProvider) {
                    const userMem = new UserMemory(aiProvider);
                    await userMem.initPromise;
                    const memoryContext = await userMem.retrieveRelevantContext(userInput, 1);
                    if (memoryContext.workflows && memoryContext.workflows.length > 0) {
                        topWorkflow = memoryContext.workflows[0];
                    }
                }
            } catch (e) {
                console.warn('[ContextManager] Failed to fetch vector context:', e.message);
            }
            return topWorkflow;
        })(),

        // 3. IMMEDIATE CONVERSATION (SQLite)
        (async () => {
            let recentDialog = [];
            try {
                if (relationalDb.db && !relationalDb.useFallback) {
                    try {
                        const logs = relationalDb.db.prepare(`
                            SELECT event, details FROM activity_logs 
                            WHERE event = 'chat' OR event = 'user_input'
                            ORDER BY timestamp DESC 
                            LIMIT 3
                        `).all();
                        recentDialog = logs.map(l => `[${l.event}] ${l.details}`).reverse();
                    } catch (e) {
                        // Silent fallback
                    }
                }
            } catch (e) {
                console.warn('[ContextManager] Failed to fetch conversation context:', e.message);
            }
            return recentDialog;
        })(),

        // 4. RELATIONAL GRAPH (Neo4j)
        (async () => {
            return await graphManager.getEntityContext(userInput);
        })()
    ]);

    const contextPayload = `
=========================================
STRICT PLANNER CONTEXT (L2)
=========================================
[ACTIVE SYSTEM STATE]
Active Window: ${activeState.activeWindow}
Current UI Focus: ${activeState.focusState}

[RELEVANT PAST WORKFLOW (L1)]
${typeof vectorContext === 'object' ? JSON.stringify(vectorContext) : vectorContext}

[RECENT DIALOGUE (Last 3 Turns)]
${sqliteContext.length > 0 ? sqliteContext.join('\n') : 'No immediate history.'}

[RELATIONAL GRAPH (L4)]
${graphContext || 'No known relationships.'}
=========================================
`.trim();

    return contextPayload;
}
