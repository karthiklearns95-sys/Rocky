import { createMachine, createActor, assign } from 'xstate';
import { formatResponse, ROCKY_SYSTEM_PROMPT } from '#brain/personality/rockyPersonality.js';
import eventBus from '#services/eventBus.js';

export const createSupervisorMachine = (agentLoop, aiProvider) => {
  return createMachine({
    id: 'conversationalSupervisor',
    initial: 'idle',
    context: {
      agentLoop,
      aiProvider,
      pendingResponse: null
    },
    states: {
      idle: {
        on: {
          USER_INPUT: 'routing'
        }
      },
      routing: {
        invoke: {
          id: 'routeIntent',
          src: 'routeIntent',
          onDone: [
            {
              target: 'conversing',
              guard: 'isConversational'
            },
            {
              target: 'delegating',
              guard: 'isActionable'
            }
          ],
          onError: {
            target: 'idle',
            actions: assign({ pendingResponse: () => "I had trouble understanding that." })
          }
        }
      },
      conversing: {
        invoke: {
          id: 'handleConversation',
          src: 'handleConversation',
          onDone: {
            target: 'responding',
            actions: assign({ pendingResponse: ({ event }) => event.output })
          },
          onError: {
            target: 'responding',
            actions: assign({ pendingResponse: () => "Conversation error." })
          }
        }
      },
      delegating: {
        invoke: {
          id: 'delegateToAgentLoop',
          src: 'delegateToAgentLoop',
          onDone: {
            target: 'idle'
          },
          onError: 'idle'
        }
      },
      responding: {
        entry: 'emitResponse',
        always: 'idle'
      }
    }
  }, {
    actions: {
      emitResponse: ({ context }) => {
        if (context.pendingResponse) {
          eventBus.emit('RESPONSE_READY', context.pendingResponse);
        }
      }
    },
    guards: {
      isConversational: ({ event }) => event.output && event.output.route === 'conversation',
      isActionable: ({ event }) => event.output && event.output.route === 'execution'
    },
    actors: {
      routeIntent: async ({ context, event }) => {
        const { text, semanticIntent } = event;
        
        if (semanticIntent && semanticIntent.route) {
            return semanticIntent;
        }
        
        const lowerInput = text.toLowerCase().trim();
        const selfGoalPatterns = [
          /^who\s+are\s+you/,
          /^what\s+(are|is)\s+you/,
          /^are\s+you\s+(a|an)?\s*(ai|robot|human)/,
          /^what\s+can\s+you\s+do/,
          /^introduce\s+yourself/,
          /^tell\s+(me\s+)?about\s+yourself/,
          /^hi\b/,
          /^hello\b/,
          /^hey\b/
        ];

        if (selfGoalPatterns.some(p => p.test(lowerInput)) || text.startsWith('AUTONOMOUS_PRESENCE_TRIGGER:')) {
           return { route: 'conversation', rawInput: text };
        }

        return { route: 'execution', rawInput: text, semanticIntent };
      },
      handleConversation: async ({ context, event }) => {
        const { rawInput } = event;
        let prompt = `${ROCKY_SYSTEM_PROMPT}\nUser: ${rawInput}\nRocky:`;
        if (rawInput.startsWith('AUTONOMOUS_PRESENCE_TRIGGER:')) {
           const msg = rawInput.replace('AUTONOMOUS_PRESENCE_TRIGGER:', '').trim();
           prompt = `${ROCKY_SYSTEM_PROMPT}\n${msg}\nRocky:`;
        }
        const resp = await context.aiProvider.generate(prompt);
        return formatResponse(resp || "I'm Rocky. How can I help?");
      },
      delegateToAgentLoop: async ({ context, event }) => {
        const { rawInput, semanticIntent } = event;
        const targetInput = semanticIntent ? JSON.stringify(semanticIntent) : rawInput;
        
        console.log(`[Supervisor] Delegating actionable intent to background AgentLoop...`);
        
        // Fire and forget, allow AgentLoop to emit RESPONSE_READY itself
        setTimeout(() => {
             context.agentLoop.run(targetInput, { isBackground: true })
                 .then(result => {
                     eventBus.emit('RESPONSE_READY', result);
                 })
                 .catch(err => {
                     console.error('[Supervisor] Background delegation error:', err);
                     eventBus.emit('RESPONSE_READY', "Rocky had an execution error.");
                 });
        }, 0);
        
        eventBus.emit('RESPONSE_READY', "Got it. I'm on it.");
        return true;
      }
    }
  });
};

export default class ConversationalSupervisor {
  constructor(agentLoop, aiProvider) {
    this.machine = createSupervisorMachine(agentLoop, aiProvider);
    this.actor = createActor(this.machine);
    this.actor.start();
  }

  processInput(text, semanticIntent = null) {
    this.actor.send({ type: 'USER_INPUT', text, semanticIntent });
  }
}
