export default class Planner {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  async createPlan(intentResult, context, rawInput) {
    console.log(`[Planner] Creating plan for intent: ${intentResult.intent}`);
    
    // Abstracted schema request
    const schema = {
      type: "object",
      properties: {
        plan: { type: "array", items: { type: "string" } },
        toolCalls: { 
          type: "array", 
          items: { 
            type: "object",
            properties: {
              toolName: { type: "string" },
              args: { type: "object" }
            }
          }
        }
      }
    };
    
    const prompt = `
      You are Rocky's Strategic Planner. Based on the user request: "${rawInput}", you must select the correct tools.
      
      STRICT RULES:
      - ONLY use tools from the list below.
      - NEVER invent new tool names (e.g., do NOT use "openNotePad", use "openApp").
      - If Grace is just chatting or asking a question that doesn't need a computer action, return toolCalls as [].
      - Do NOT call a tool unless Grace explicitly asks for an action (e.g., "take a screenshot", "open app", "send email").
      - CORRECT TYPOS: If Grace misspells an app name (e.g., "Chrome") or tool, fix it in the toolCalls arguments.
      - The order of toolCalls matters. Rocky executes them in sequence.
      
      AVAILABLE TOOLS:
      - takeScreenshot(): No arguments.
      - openApp(appName): Launch any app (e.g. "Chrome", "VS Code", "Spotify").
      - systemControl(action): "volume_up", "volume_down", "mute".
      - searchFiles(query): Search local desktop files.
      - createFile(fileName, content): Create any file (text, .py, .js, .html) on the desktop. Use this for CODE GENERATION.
      - deleteFile(fileName): Delete a file.
      - webSearch(query): Search the internet for answers.
      - sendEmail(recipient, subject, body): Compose and send an email.
      - runCommand(command): Execute a shell command on the desktop.
      
      EXAMPLE FOR DEVELOPER WORKFLOW:
      User: "Write a python script that prints hello world and run it"
      toolCalls: [
        { "toolName": "createFile", "args": { "fileName": "hello.py", "content": "print('Hello from Rocky and Grace!')" } },
        { "toolName": "runCommand", "args": { "command": "python hello.py" } }
      ]
      
      EXAMPLE FOR MULTI-STEP:
      User: "Search for the CEO of Apple and save it to ceo.txt"
      toolCalls: [
        { "toolName": "webSearch", "args": { "query": "CEO of Apple" } },
        { "toolName": "createFile", "args": { "fileName": "ceo.txt", "content": "The CEO of Apple is Tim Cook." } }
      ]
      
      EXAMPLE FOR EMAIL:
      User: "Email karthik@example.com about the project status"
      toolCalls: [
        { "toolName": "sendEmail", "args": { "recipient": "karthik@example.com", "subject": "Project Status", "body": "Hi, I wanted to update you on the project status..." } }
      ]

      EXAMPLE FOR NO TOOL (CONVERSATION):
      User: "How are you today Rocky?"
      toolCalls: []
      
      Output JSON format:
      {
        "plan": ["Brief description of steps"],
        "toolCalls": [
          { "toolName": "webSearch", "args": { "query": "who is the CEO of Google?" } }
        ]
      }
    `;

    const result = await this.aiProvider.generateStructured(prompt, schema);
    return result;
  }
}
