import { commandExecutor } from '../executor/index.js';

export default class ToolManager {
  constructor() {
    this.tools = new Map();
  }

  registerTool(toolName, handler) {
    this.tools.set(toolName, handler);
  }

  getAvailableTools() {
    return Array.from(this.tools.keys());
  }

  async execute(toolName, args) {
    console.log(`[ToolManager] Executing tool: ${toolName}`);
    
    // Fallback: If the tool is directly an OS command allowed by executor
    if (toolName === 'os_command') {
      return await commandExecutor.execute(args.command);
    }
    
    if (this.tools.has(toolName)) {
      const handler = this.tools.get(toolName);
      return await handler(args);
    } else {
      throw new Error(`Tool not found: ${toolName}`);
    }
  }
}
