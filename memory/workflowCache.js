import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, '..', 'data', 'workflow_cache.json');

export default class WorkflowCache {
  constructor() {
    this.cache = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        this.cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      }
    } catch (e) {
      console.warn('[WorkflowCache] Could not load cache:', e.message);
      this.cache = {};
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
    } catch (e) {
      console.warn('[WorkflowCache] Could not save cache:', e.message);
    }
  }

  generateKey(goal, entities) {
    // Sort keys to ensure consistent hash regardless of entity order
    const sortedEntities = Object.keys(entities || {}).sort().reduce((acc, key) => {
      acc[key] = entities[key];
      return acc;
    }, {});
    
    // Hash is simply a deterministic string
    return `${goal}::${JSON.stringify(sortedEntities)}`;
  }

  get(goal, entities) {
    const key = this.generateKey(goal, entities);
    const entry = this.cache[key];
    
    if (entry) {
      // Decay: If older than 7 days, invalidate
      if (Date.now() - entry.timestamp > 7 * 24 * 60 * 60 * 1000) {
        delete this.cache[key];
        this.save();
        return null;
      }
      return entry.plan;
    }
    return null;
  }

  set(goal, entities, plan) {
    // ONLY store valid non-empty plans
    if (!plan || !Array.isArray(plan) || plan.length === 0) return;
    
    const key = this.generateKey(goal, entities);
    this.cache[key] = {
      plan,
      timestamp: Date.now()
    };
    this.save();
    console.log(`[WorkflowCache] Saved workflow for goal: ${goal}`);
  }

  invalidate(goal, entities) {
    const key = this.generateKey(goal, entities);
    if (this.cache[key]) {
      delete this.cache[key];
      this.save();
      console.log(`[WorkflowCache] Invalidated cache for goal: ${goal}`);
    }
  }
}

export const workflowCache = new WorkflowCache();
