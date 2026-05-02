export default class IntentParser {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  async parse(input) {
    console.log(`[IntentParser] Parsing input: "${input}"`);
    
    // Abstracted schema request
    const schema = {
      type: "object",
      properties: {
        intent: { type: "string" },
        confidence: { type: "number" },
        appName: { type: "string" },
        position: { type: "string" }
      }
    };
    
    const prompt = `
      Extract intent from: "${input}"
      
      CRITICAL: Grace might make spelling mistakes (e.g., "moyte[aod" instead of "Notepad"). 
      Use FUZZY MATCHING and CONTEXT to deduce the real intent. 
      If a word looks like a tool name but is misspelled, treat it as that tool.
      
      NORMALIZATION RULES:
      - "note pad" or "note pad" -> "notepad"
      - "google chrome" -> "chrome"
      - "visual studio code" -> "vscode"
      
      POSSIBLE INTENTS:
      - move_position: Triggered by "go to", "move to", "walk to" followed by a screen location (e.g., "top left", "center", "bottom right").
      - open_app: Triggered by "open", "launch", "start", "run" followed by an app name.
      - take_screenshot: When asking to capture the screen.
      - system_control: When asking to change volume or mute.
      - search_files: When asking to find/search for files.
      - file_manage: When asking to create, read, or delete a file (e.g. "Create a python file", "Write code").
      - web_search: When asking a question that requires looking up information online.
      - greeting: Basic hello/hi.
      
      If intent is "open_app", you MUST provide the "appName" (normalized) in the output JSON.
      If intent is "move_position", you MUST provide the "position" (e.g., "top left", "top right", "bottom left", "bottom right", "center") in the output JSON.
    `;
    
    const result = await this.aiProvider.generateStructured(prompt, schema);
    
    // Fallback if AI fails to return a clean intent
    if (!result || !result.intent) {
      return { intent: 'general_query', confidence: 0.5 };
    }
    
    return result;
  }
}
