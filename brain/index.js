import ApiProvider from './aiProvider/apiProvider.js';
import LocalProvider from './aiProvider/localProvider.js';
import IntentParser from './intent/intentParser.js';
import ContextLoader from './context/contextLoader.js';
import Planner from './planner/planner.js';
import DecisionEngine from './decision/decisionEngine.js';
import ResponseFormatter from './response/responseFormatter.js';
import eventBus from '../controller/eventBus.js';
import toolManager from '../tools/index.js';
import memoryManager from '../memory/index.js';

class Brain {
  constructor() {
    // Configurable provider selection
    const useLocal = false; // Toggle this to switch between API and Local
    this.aiProvider = useLocal ? new LocalProvider('./models/llama.gguf') : new ApiProvider('MOCK_KEY', 'https://api.openai.com');
    
    // Pipeline initialization
    this.intentParser = new IntentParser(this.aiProvider);
    this.contextLoader = new ContextLoader(memoryManager); // REAL memoryManager injected
    this.planner = new Planner(this.aiProvider);
    this.decisionEngine = new DecisionEngine(toolManager); // REAL toolManager injected
    this.responseFormatter = new ResponseFormatter(this.aiProvider);
    
    console.log('[Brain] Initialized with modular pipeline.');
    this.setupListeners();
  }

  setupListeners() {
    // Controller sends user input to the brain via EventBus
    eventBus.on('USER_INPUT', async (text) => {
      try {
        const response = await this.process(text);
        eventBus.emit('RESPONSE_READY', response);
      } catch (error) {
        console.error('[Brain] Processing error:', error);
        eventBus.emit('RESPONSE_READY', "I'm sorry, Grace. I encountered an error processing that.");
      }
    });
  }

  /**
   * The single exposed entry point for the brain.
   */
  async process(input) {
    console.log(`\n--- [Brain] Processing Input: "${input}" ---`);
    eventBus.emit('STATE_CHANGE', 'thinking');
    
    // 1. Parse Intent
    const intentResult = await this.intentParser.parse(input);
    
    // 2. Load Context
    const context = await this.contextLoader.load(intentResult);
    
    // 3. Create Execution Plan
    const planResult = await this.planner.createPlan(intentResult, context);
    
    // 4. Decide & Execute Actions
    const executionResults = await this.decisionEngine.executePlan(planResult);
    
    // 5. Format Output Response
    const finalResponse = await this.responseFormatter.format(intentResult, executionResults);
    
    console.log(`--- [Brain] Finished Processing ---\n`);
    return finalResponse;
  }
}

const brain = new Brain();
export default brain;
