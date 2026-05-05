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
import AppActionMapper from './appMapper/appActionMapper.js';
import eventBus from '../controller/eventBus.js';
import toolManager from '../tools/index.js';
import memoryManager from '../memory/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// Load environment variables
dotenv.config();

class Brain {
  constructor() {
    // ── AI Provider Selection ──
    const useLocal = true;
    this.aiProvider = useLocal
      ? new LocalProvider('mistral')
      : new OpenAiProvider(process.env.OPENAI_API_KEY);

    // Inject AI provider into tool manager for vision/smart tools
    toolManager.aiProvider = this.aiProvider;

    // ── Core Pipeline Modules ──
    this.intentParser = new IntentParser(this.aiProvider);
    this.contextLoader = new ContextLoader(memoryManager);
    this.planner = new Planner(this.aiProvider);

    // ── Contextual Mapping Engine ──
    this.appActionMapper = new AppActionMapper(rootDir);

    // ── Unified Agent Loop (replaces fragmented engines) ──
    this.agentLoop = new AgentLoop(
      this.intentParser,
      this.planner,
      toolManager,
      this.aiProvider,
      this.appActionMapper
    );

    // ── Legacy modules kept for backward compatibility ──
    this.decisionEngine = new DecisionEngine(toolManager);
    this.responseFormatter = new ResponseFormatter(this.aiProvider);

    // ── Background Presence ──
    this.presenceManager = new PresenceManager(eventBus);

    // ── Concurrency Lock ──
    this.isProcessing = false;  // Only ONE AgentLoop at a time
    this.pendingPresence = null; // Drop stale presence triggers if busy

    console.log('[Brain] Initialized with Unified Agent Loop.');
    this.setupListeners();
    this.presenceManager.start();
  }

  setupListeners() {
    eventBus.on('USER_INPUT', async (text) => {
      const isPresenceTrigger = text.startsWith('AUTONOMOUS_PRESENCE_TRIGGER:');

      // Drop stale presence triggers if Rocky is already busy
      if (this.isProcessing) {
        if (isPresenceTrigger) {
          console.log('[Brain] Busy — dropping presence trigger.');
          return;
        }
        // For real user input while busy: queue it (cancel previous queue)
        console.log('[Brain] Busy — queuing user input.');
        this.pendingInput = text;
        return;
      }

      this.presenceManager.resetTimer();
      try {
        const response = await this.process(text);
        eventBus.emit('RESPONSE_READY', response);
      } catch (error) {
        console.error('[Brain] Processing error:', error);
        eventBus.emit('RESPONSE_READY', "Grace… Rocky see error. Rocky is brave. We try again?");
      } finally {
        // After finishing, process any queued real user input
        if (this.pendingInput) {
          const next = this.pendingInput;
          this.pendingInput = null;
          setImmediate(() => eventBus.emit('USER_INPUT', next));
        }
      }
    });
  }

  /**
   * Single entry point — all requests go through the Unified Agent Loop.
   */
  async process(input) {
    console.log(`\n--- [Brain] Processing: "${input}" ---`);
    this.isProcessing = true;
    eventBus.emit('STATE_CHANGE', 'thinking');

    try {
      const finalResponse = await this.agentLoop.run(input);

      memoryManager.remember(`User said: ${input}`, ['user_input']);
      memoryManager.remember(`Rocky responded: ${finalResponse}`, ['agent_response']);

      console.log(`--- [Brain] Finished Processing ---\n`);
      return finalResponse;
    } catch (error) {
      console.error('[Brain] Process error:', error);
      return "Grace, Rocky had a tiny hiccup. Rocky is okay. What else?";
    } finally {
      this.isProcessing = false;
    }
  }
}

const brain = new Brain();
export default brain;
