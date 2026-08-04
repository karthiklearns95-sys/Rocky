import ApiProvider from '#brain/aiProvider/apiProvider.js';
import OpenAiProvider from '#brain/aiProvider/openAiProvider.js';
import LocalProvider from '#brain/aiProvider/localProvider.js';
import ContextLoader from '#brain/context/contextLoader.js';
import WorkflowPlanner from '#brain/planner/workflowPlanner.js';
import AgentLoop from '#brain/orchestrator/agentLoop.js';
import ConversationalSupervisor from '#brain/orchestrator/conversationalSupervisor.js';
import PresenceManager from '#brain/presence/presenceManager.js';
import AppActionMapper from '#brain/appMapper/appActionMapper.js';
import eventBus from '#services/eventBus.js';
import toolManager from '#tools/index.js';
import { SemanticInterpreter } from '#voice/interpreter/semanticInterpreter.js';
import { graphManager } from '#memory/graphManager.js';
import { abortManager } from './runtime/abortManager.js';
import { runtimeCoordinator } from './runtime/recoveryCoordinator.js';
import { withGuard, AbortError } from './runtime/executionGuard.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// Load environment variables
dotenv.config();

const DEBUG_MODE = process.env.NODE_ENV !== 'production';

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
    this.planner = new WorkflowPlanner(this.aiProvider);

    // ── Contextual Mapping Engine ──
    this.appActionMapper = new AppActionMapper(rootDir);

    // ── Unified Agent Loop (replaces fragmented engines) ──
    this.agentLoop = new AgentLoop(
      this.planner,
      toolManager,
      this.aiProvider,
      this.appActionMapper
    );
    
    // ── Non-blocking XState Supervisor ──
    this.supervisor = new ConversationalSupervisor(this.agentLoop, this.aiProvider);

    this.contextLoader = new ContextLoader(this.agentLoop.userMemory);
    this.semanticInterpreter = new SemanticInterpreter(this.aiProvider);

    // ── Background Presence ──
    this.presenceManager = new PresenceManager(eventBus);

    // ── Concurrency Lock ──
    this.isProcessing = false;  // Only ONE AgentLoop at a time
    this.pendingPresence = null; // Drop stale presence triggers if busy
    this.currentAbortController = null;

    console.log('[Brain] Initialized with Unified Agent Loop.');
    this.setupListeners();
    this.presenceManager.start();
  }

  setupListeners() {
    eventBus.on('ABORT_EXECUTION', () => {
      console.log('[Brain] 🛑 Global Abort Triggered via eventBus.');
      runtimeCoordinator.handleInterrupt('User triggered global abort');
    });

    eventBus.on('USER_INPUT', async (text) => {
      const isPresenceTrigger = text.startsWith('AUTONOMOUS_PRESENCE_TRIGGER:');

      // Drop stale presence triggers if Rocky is already busy
      if (this.isProcessing) {
        if (isPresenceTrigger) {
          console.log('[Brain] Busy — dropping presence trigger.');
          return;
        }
        // Mid-workflow redirection: abort the running workflow and queue the new command.
        // Guard: if handleInterrupt throws, isProcessing must still be reset so we
        // don't permanently deadlock all future USER_INPUT events.
        console.log('[Brain] Mid-workflow redirection triggered! Aborting current workflow...');
        this.pendingInput = text;
        try {
          await runtimeCoordinator.handleInterrupt('New user command received');
        } catch (interruptErr) {
          console.error('[Brain] Interrupt handler threw — forcing isProcessing reset:', interruptErr);
          this.isProcessing = false;
        }
        return;
      }

      this.presenceManager.resetTimer();
      try {
        await this.process(text);
        // RESPONSE_READY is now emitted asynchronously by the Supervisor or Worker
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
    abortManager.reset();
    runtimeCoordinator.setState('RUNNING');
    const signal = abortManager.getSignal();
    eventBus.emit('STATE_CHANGE', 'thinking');

    try {
      if (signal.aborted) return "Action aborted.";

      // 1. Parallel Context Retrieval: RAG memory + knowledge graph + session context
      const [ragContext, graphContext, sessionCtx] = await Promise.all([
        this.agentLoop.userMemory.retrieveRelevantContext(input),
        graphManager.getEntityContext(input),
        this.contextLoader.load({ intent: input }).catch(() => ({ userName: process.env.ROCKY_USER_NAME || 'Grace', time: new Date().toISOString(), recentHistory: [] }))
      ]);
      
      if (DEBUG_MODE) console.log(`[Brain] Session context loaded for ${sessionCtx.userName}. Recent history: ${sessionCtx.recentHistory?.length || 0} entries.`);
      
      let ragString = '';
      if (ragContext && (ragContext.facts.length > 0 || ragContext.workflows.length > 0)) {
        ragString += `Relevant user knowledge:\n- ${ragContext.facts.join('\n- ')}\n`;
        if (ragContext.workflows.length > 0) ragString += `\nPast Workflows:\n- ${ragContext.workflows.join('\n- ')}\n`;
      }
      if (graphContext && graphContext.length > 0) {
        ragString += `${ragString ? '\n' : '\n\nRelevant user knowledge:\n'}Knowledge Graph:\n- ${graphContext.join('\n- ')}\n`;
      }

      // 2. Unified Semantic Interpretation (repairs speech, resolves context, classifies domain)
      const semanticIntent = await withGuard(
        this.semanticInterpreter.interpret(input, ragString),
        signal,
        'semantic_interpreter'
      );
      console.log(`[Brain] Semantic Intent:`, semanticIntent);

      if (signal.aborted) return "Action aborted.";

      // Pass the fully structured JSON intent to the Supervisor
      const targetInput = semanticIntent ? JSON.stringify(semanticIntent) : input;

      // The Supervisor operates asynchronously and emits its own RESPONSE_READY events
      this.supervisor.processInput(targetInput, semanticIntent);

      // Save to semantic memory via UserMemory (non-blocking)
      this.agentLoop.userMemory.saveMemory({ type: 'fact', content: `User said: ${input}`, confidence: 0.5 });

      console.log(`--- [Brain] Finished Routing to Supervisor ---\n`);
      return;
    } catch (error) {
      if (error instanceof AbortError || error.name === 'AbortError') {
        console.log('[Brain] Process aborted cleanly.');
        eventBus.emit('RESPONSE_READY', "Grace, I've stopped what I was doing.");
        return;
      }
      console.error('[Brain] Process error:', error);
      eventBus.emit('RESPONSE_READY', "Grace, Rocky had a tiny hiccup. Rocky is okay. What else?");
      return;
    } finally {
      this.isProcessing = false;
      if (runtimeCoordinator.getState() !== 'IDLE') {
        runtimeCoordinator.setState('IDLE');
      }
    }
  }
}

const brain = new Brain();
export default brain;
