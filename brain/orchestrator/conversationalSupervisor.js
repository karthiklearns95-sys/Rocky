import { createMachine, createActor, assign, fromPromise } from 'xstate';
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
          input: ({ context, event }) => ({ context, event }),
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
          input: ({ context, event }) => ({ context, event }),
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
          input: ({ context, event }) => ({ context, event }),
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
      routeIntent: fromPromise(async ({ input }) => {
        const { text, semanticIntent } = input.event;
        
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
      }),
      handleConversation: fromPromise(async ({ input }) => {
        const { text } = input.event;
        let prompt = `${ROCKY_SYSTEM_PROMPT}\nUser: ${text}\nRocky:`;
        if (text.startsWith('AUTONOMOUS_PRESENCE_TRIGGER:')) {
           const msg = text.replace('AUTONOMOUS_PRESENCE_TRIGGER:', '').trim();
           prompt = `${ROCKY_SYSTEM_PROMPT}\n${msg}\nRocky:`;
        }
        const resp = await input.context.aiProvider.generate(prompt);
        return formatResponse(resp || "I'm Rocky. How can I help?");
      }),
      delegateToAgentLoop: fromPromise(async ({ input }) => {
        const { text, semanticIntent } = input.event;
        const targetInput = semanticIntent ? JSON.stringify(semanticIntent) : text;
        
        console.log(`[Supervisor] Delegating actionable intent to background AgentLoop...`);
        
        // Fire and forget, allow AgentLoop to emit RESPONSE_READY itself
        setTimeout(() => {
             input.context.agentLoop.run(targetInput, { isBackground: true })
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
      })
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
