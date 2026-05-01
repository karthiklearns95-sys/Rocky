import ToolManager from './toolManager.js';

const toolManager = new ToolManager();

// Register mock tools
toolManager.registerTool('openApp', async (args) => {
  console.log(`[Tool: openApp] Opening application: ${args.appName}`);
  return `Successfully opened ${args.appName}`;
});

toolManager.registerTool('createTask', async (args) => {
  console.log(`[Tool: createTask] Created task: ${args.taskName}`);
  return `Task created: ${args.taskName}`;
});

export default toolManager;
