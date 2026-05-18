import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Semantic Router (L0 Cache)
 * Eliminates fragile Regex intent parsing by evaluating semantic vector similarity.
 */
class SemanticRouter {
  constructor() {
    this.dbPath = path.join(__dirname, '..', '..', 'data', 'vector');
    this.db = null;
    this.table = null;
    this.tableName = 'fast_path_intents';
    this.initPromise = this.init();
  }

  async init() {
    try {
      this.db = await lancedb.connect(this.dbPath);
    } catch (e) {
      console.error(`[SemanticRouter] Init error:`, e.message);
    }
  }

  async seedClusters(aiProvider) {
    if (!this.db) return;
    try {
      const existingTables = await this.db.tableNames();
      if (existingTables.includes(this.tableName)) {
        this.table = await this.db.openTable(this.tableName);
        return;
      }
      
      console.log('[SemanticRouter] Seeding deterministic intent clusters...');
      const clusters = [
        // Launch App: Spotify
        { text: "open spotify", intent: "LaunchApp_Spotify" },
        { text: "play music", intent: "LaunchApp_Spotify" },
        { text: "put on tunes", intent: "LaunchApp_Spotify" },
        { text: "start spotify", intent: "LaunchApp_Spotify" },
        { text: "play a song", intent: "LaunchApp_Spotify" },
        
        // Launch App: WhatsApp
        { text: "open whatsapp", intent: "LaunchApp_WhatsApp" },
        { text: "send a message", intent: "LaunchApp_WhatsApp" },
        { text: "message someone", intent: "LaunchApp_WhatsApp" },
        { text: "text my friend", intent: "LaunchApp_WhatsApp" },
        
        // Launch App: Notepad
        { text: "open notepad", intent: "LaunchApp_Notepad" },
        { text: "write something down", intent: "LaunchApp_Notepad" },
        { text: "take a note", intent: "LaunchApp_Notepad" },
        { text: "jot this down", intent: "LaunchApp_Notepad" },
        
        // Launch App: Calculator
        { text: "open calculator", intent: "LaunchApp_Calculator" },
        { text: "do some math", intent: "LaunchApp_Calculator" },
        { text: "calculate this", intent: "LaunchApp_Calculator" },
        
        // Launch App: Chrome
        { text: "open chrome", intent: "LaunchApp_Chrome" },
        { text: "browse the web", intent: "LaunchApp_Chrome" },
        { text: "search the internet", intent: "LaunchApp_Chrome" }
      ];

      const data = [];
      for (const c of clusters) {
        const vector = await aiProvider.embed(c.text);
        if (vector && Array.isArray(vector)) {
          data.push({ vector, text: c.text, intent: c.intent });
        }
      }

      if (data.length > 0) {
        this.table = await this.db.createTable(this.tableName, data);
        console.log('[SemanticRouter] Seeding complete.');
      }
    } catch (e) {
      console.error(`[SemanticRouter] Seeding error:`, e.message);
    }
  }

  async getDeterministicRoute(ctx, aiProvider) {
    await this.initPromise;
    if (!this.table) await this.seedClusters(aiProvider);
    if (!this.table) return null;

    const userInput = String(ctx.rawInput || '').toLowerCase().trim();
    if (!userInput) return null;

    // Optional quick-passthrough for extremely simple single-word triggers
    const knownApps = ['spotify', 'notepad', 'calculator', 'chrome', 'whatsapp'];
    if (knownApps.includes(userInput)) {
       console.log(`[SemanticRouter] Direct app name trigger: ${userInput}`);
       return this._buildRoutePlan(`LaunchApp_${userInput.charAt(0).toUpperCase() + userInput.slice(1)}`, ctx);
    }

    try {
      const vector = await aiProvider.embed(userInput);
      if (!vector || !Array.isArray(vector)) return null;

      let results = await this.table
        .search(vector)
        .limit(1)
        .execute();

      if (!Array.isArray(results)) {
        if (results && typeof results.toArray === 'function') {
           results = results.toArray();
        } else {
           results = Array.from(results || []);
        }
      }

      if (results.length > 0) {
        const topMatch = results[0];
        // Threshold check. For normalized embeddings, _distance < 0.3 or 0.4 indicates strong similarity.
        // If distance is large (e.g. > 0.6), the semantic gap is too wide.
        const similarityScore = topMatch._distance;
        
        console.log(`[SemanticRouter] Top match: "${topMatch.text}" (Distance: ${similarityScore.toFixed(4)})`);
        
        // 0.85 similarity roughly equates to a very small L2 distance threshold in typical embedding spaces
        if (similarityScore < 0.50) { 
          console.log(`[SemanticRouter] Semantic Threshold Met. Routing to fast path: ${topMatch.intent}`);
          return this._buildRoutePlan(topMatch.intent, ctx);
        }
      }
    } catch (e) {
      console.error(`[SemanticRouter] Search error:`, e.message);
    }

    console.log('[SemanticRouter] No deterministic route found (Semantic gap too wide). Deferring to L2 LLM Planner.');
    return null;
  }

  // --- Helper Extraction Methods ---

  _asEntityValue(value) {
    if (Array.isArray(value)) return value[0];
    return value;
  }

  _extractSearchText(ctx) {
    const entities = ctx.intentData?.entities || {};
    const direct = this._asEntityValue(entities.song || entities.artist || entities.query || entities.search);
    if (direct) return String(direct);

    const raw = String(ctx.rawInput || '');
    const searchMatch = raw.match(/\bsearch\s+(?:for\s+)?(.+?)(?:,?\s+and\s+play|,?\s+and\s+open|$)/i);
    if (searchMatch) return searchMatch[1].trim();

    const playMatch = raw.match(/\bplay\s+(.+?)(?:\s+on\s+\w+|$)/i);
    if (playMatch) return playMatch[1].trim();
    return null;
  }
  
  _extractContactAndMessage(ctx) {
    const entities = ctx.intentData?.entities || {};
    const contact = this._asEntityValue(entities.contact || entities.person || entities.target);
    const msg = this._asEntityValue(entities.message || entities.text);
    return {
       contact: contact ? String(contact) : null,
       message: msg ? String(msg) : "hello"
    };
  }

  _extractTextToType(ctx) {
    const text = String(ctx.rawInput || '');
    const quoted = text.match(/["'“”](.+?)["'“”]/);
    if (quoted) return quoted[1];
    const writeMatch = text.match(/\b(?:write|type)\s+(.+)$/i);
    if (writeMatch) return writeMatch[1].trim();
    return 'Reminder: drink water.';
  }

  _buildRoutePlan(intent, ctx) {
    switch (intent) {
      case 'LaunchApp_Spotify': {
        const query = this._extractSearchText(ctx);
        if (query) {
          return [
            { tool: 'open_resource', input: { query: 'spotify' } },
            { tool: 'waitForAppReady', input: { appName: 'spotify' } },
            { tool: 'focusWindow', input: { appName: 'spotify' } },
            { tool: 'pressKey', input: { key: '^l' } },
            { tool: 'typeText', input: { text: query } },
            { tool: 'pressKey', input: { key: '{ENTER}' } },
            { tool: 'pressKey', input: { key: '{TAB}' } },
            { tool: 'pressKey', input: { key: '{ENTER}' } }
          ];
        }
        return [
          { tool: 'open_resource', input: { query: 'spotify' } },
          { tool: 'waitForAppReady', input: { appName: 'spotify' } },
          { tool: 'focusWindow', input: { appName: 'spotify' } }
        ];
      }
      case 'LaunchApp_WhatsApp': {
        const { contact, message } = this._extractContactAndMessage(ctx);
        if (contact) {
            return [
              { tool: 'open_resource', input: { query: 'whatsapp' } },
              { tool: 'waitForAppReady', input: { appName: 'whatsapp' } },
              { tool: 'focusWindow', input: { appName: 'whatsapp' } },
              { tool: 'pressKey', input: { key: '^f' } },
              { tool: 'typeText', input: { text: contact } },
              { tool: 'pressKey', input: { key: '{ENTER}' } },
              { tool: 'typeText', input: { text: message } },
              { tool: 'pressKey', input: { key: '{ENTER}' } }
            ];
        }
        return [
            { tool: 'open_resource', input: { query: 'whatsapp' } },
            { tool: 'waitForAppReady', input: { appName: 'whatsapp' } },
            { tool: 'focusWindow', input: { appName: 'whatsapp' } }
        ];
      }
      case 'LaunchApp_Notepad': {
        const hasWrite = /\b(write|type)\b/.test(String(ctx.rawInput||'').toLowerCase());
        if (hasWrite) {
          const text = this._extractTextToType(ctx);
          return [
            { tool: 'open_resource', input: { query: 'notepad' } },
            { tool: 'waitForAppReady', input: { appName: 'notepad' } },
            { tool: 'focusWindow', input: { appName: 'notepad' } },
            { tool: 'typeText', input: { text } }
          ];
        }
        return [
          { tool: 'open_resource', input: { query: 'notepad' } },
          { tool: 'waitForAppReady', input: { appName: 'notepad' } },
          { tool: 'focusWindow', input: { appName: 'notepad' } }
        ];
      }
      case 'LaunchApp_Calculator': {
         const lower = String(ctx.rawInput || '').toLowerCase();
         const expressionMatch = lower.match(/\b(?:calculate|what is|how much is)\s+([0-9+\-*/().\s]+)/i);
         if (expressionMatch && expressionMatch[1].trim()) {
           return [
             { tool: 'open_resource', input: { query: 'calculator' } },
             { tool: 'waitForAppReady', input: { appName: 'calculator' } },
             { tool: 'focusWindow', input: { appName: 'calculator' } },
             { tool: 'calculate', input: { expression: expressionMatch[1].trim() } }
           ];
         }
         return [
          { tool: 'open_resource', input: { query: 'calculator' } },
          { tool: 'waitForAppReady', input: { appName: 'calculator' } },
          { tool: 'focusWindow', input: { appName: 'calculator' } }
        ];
      }
      case 'LaunchApp_Chrome':
        return [
          { tool: 'open_resource', input: { query: 'chrome' } },
          { tool: 'waitForAppReady', input: { appName: 'chrome' } },
          { tool: 'focusWindow', input: { appName: 'chrome' } }
        ];
      default:
        return null;
    }
  }
}

export const semanticRouter = new SemanticRouter();
