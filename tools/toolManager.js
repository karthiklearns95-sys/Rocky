import { commandExecutor } from '../executor/index.js';

export default class ToolManager {
  constructor() {
    this.tools = new Map();
  }

  registerTool(toolName, handler) {
    this.tools.set(toolName, handler);
    console.log(`[ToolManager] Registered: ${toolName}`);
  }

  /** Check if a tool name is registered */
  has(toolName) {
    return this.tools.has(toolName);
  }

  /** Return array of registered tool names for planner prompts */
  list() {
    return Array.from(this.tools.keys());
  }

  // Legacy alias used by old callers
  getAvailableTools() {
    return this.list();
  }

  async execute(toolName, args) {
    console.log(`[ToolManager] Executing: ${toolName}`, args);

    if (!this.tools.has(toolName)) {
      const err = `Tool not found: ${toolName}`;
      console.error(`[ToolManager] ${err}`);
      return { success: false, data: null, error: err };
    }

    try {
      const handler = this.tools.get(toolName);
      const result = await handler(args);

      // If the tool already returns {success, ...} pass it through; otherwise wrap it.
      if (result && typeof result === 'object' && 'success' in result) {
        return result;
      }
      return { success: true, data: result, error: null };
    } catch (err) {
      console.error(`[ToolManager] Execution failed for ${toolName}:`, err.message);
      return { success: false, data: null, error: err.message };
    }
  }
}
