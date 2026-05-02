import ApiProvider from './aiProvider/apiProvider.js';
import OpenAiProvider from './aiProvider/openAiProvider.js';
import LocalProvider from './aiProvider/localProvider.js';
import IntentParser from './intent/intentParser.js';
import ContextLoader from './context/contextLoader.js';
import Planner from './planner/planner.js';
import DecisionEngine from './decision/decisionEngine.js';
import ResponseFormatter from './response/responseFormatter.js';
import AgentLoop from './orchestrator/agentLoop.js';
import PresenceManager from './presence/presenceManager.js';
import eventBus from '../controller/eventBus.js';
import toolManager from '../tools/index.js';
import memoryManager from '../memory/index.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class Brain {
  constructor() {
    // ── AI Provider Selection ──
    const useLocal = true;
    this.aiProvider = useLocal
      ? new LocalProvider('mistral')
      : new OpenAiProvider(process.env.OPENAI_API_KEY);

    // ── Core Pipeline Modules ──
    this.intentParser = new IntentParser(this.aiProvider);
    this.contextLoader = new ContextLoader(memoryManager);
    this.planner = new Planner(this.aiProvider);

    // ── Unified Agent Loop (replaces fragmented engines) ──
    this.agentLoop = new AgentLoop(
      this.intentParser,
      this.planner,
      toolManager,
      this.aiProvider
    );

    // ── Legacy modules kept for backward compatibility ──
    this.decisionEngine = new DecisionEngine(toolManager);
    this.responseFormatter = new ResponseFormatter(this.aiProvider);

    // ── Background Presence ──
    this.presenceManager = new PresenceManager(eventBus);

    console.log('[Brain] Initialized with Unified Agent Loop.');
    this.setupListeners();
    this.presenceManager.start();
  }

  setupListeners() {
    eventBus.on('USER_INPUT', async (text) => {
      this.presenceManager.resetTimer();
      try {
        const response = await this.process(text);
        eventBus.emit('RESPONSE_READY', response);
      } catch (error) {
        console.error('[Brain] Processing error:', error);
        eventBus.emit('RESPONSE_READY', "Grace… Rocky see error. Rocky is brave. We try again?");
      }
    });
  }

  /**
   * Single entry point — all requests go through the Unified Agent Loop.
   */
  async process(input) {
    console.log(`\n--- [Brain] Processing: "${input}" ---`);
    eventBus.emit('STATE_CHANGE', 'thinking');

    try {
      // Run the unified agent loop
      const finalResponse = await this.agentLoop.run(input);

      // Save to memory
      memoryManager.remember(`User said: ${input}`, ['user_input']);
      memoryManager.remember(`Rocky responded: ${finalResponse}`, ['agent_response']);

      console.log(`--- [Brain] Finished Processing ---\n`);
      return finalResponse;
    } catch (error) {
      console.error('[Brain] Process error:', error);
      return "Grace, Rocky had a tiny hiccup. Rocky is okay. What else?";
    }
  }
}

const brain = new Brain();
export default brain;
