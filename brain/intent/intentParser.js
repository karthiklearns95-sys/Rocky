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
        confidence: { type: "number" }
      }
    };
    
    const prompt = `
      Extract intent from: "${input}"
      
      POSSIBLE INTENTS:
      - take_screenshot: When asking to capture, save or take a screenshot.
      - open_app: When asking to open or launch an application.
      - system_control: When asking to change volume or mute.
      - search_files: When asking to find or search for files.
      - file_manage: When asking to create, read, or delete a file.
      - web_search: When asking a general question that requires looking up information online.
      - send_email: When asking to send or write an email.
      - greeting: Basic hello/hi.
      - general_query: Anything else.
    `;
    
    const result = await this.aiProvider.generateStructured(prompt, schema);
    
    // Fallback if AI fails to return a clean intent
    if (!result || !result.intent) {
      return { intent: 'general_query', confidence: 0.5 };
    }
    
    return result;
  }
}
