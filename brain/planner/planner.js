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
      - If the user asks for multiple things (e.g., "search AND save"), you MUST include multiple objects in the toolCalls array.
      - The order of toolCalls matters. Rocky executes them in sequence.
      
      AVAILABLE TOOLS:
      - takeScreenshot(): No arguments.
      - openApp(appName): e.g. "Chrome".
      - systemControl(action): "volume_up", "volume_down", "mute".
      - searchFiles(query): Search local desktop files.
      - createFile(fileName, content): Create a file on the desktop.
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
