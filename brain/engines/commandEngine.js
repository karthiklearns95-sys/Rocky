import eventBus from '../../controller/eventBus.js';

/**
 * CommandEngine: Handles system and tool actions.
 */
export default class CommandEngine {
  constructor(planner, decisionEngine, responseFormatter) {
    this.planner = planner;
    this.decisionEngine = decisionEngine;
    this.responseFormatter = responseFormatter;
  }

  async handle(intentResult, context, rawInput) {
    let planResult;

    // Fast-path: Bypass planner for simple, direct commands
    if (intentResult.intent === 'open_app' && intentResult.appName) {
      planResult = {
        plan: [`Opening application: ${intentResult.appName}`],
        toolCalls: [
          { toolName: 'openApp', args: { appName: intentResult.appName } }
        ]
      };
    } else if (intentResult.intent === 'move_position') {
      // Inline fallback: extract position from raw text if AI missed it
      let position = intentResult.position;
      if (!position && rawInput) {
        const lower = rawInput.toLowerCase();
        const positions = ['top left', 'top right', 'bottom left', 'bottom right', 'center'];
        for (const pos of positions) {
          if (lower.includes(pos)) { position = pos; break; }
        }
      }
      position = position || 'bottom left'; // Ultimate fallback

      console.log(`[CommandEngine] Moving Rocky to: ${position}`);
      eventBus.emit('MOVE_AGENT', position);

      return {
        type: 'response',
        data: `Grace, Rocky moving to ${position}.`
      };
    } else {
      // 1. Create a plan for complex tool actions
      planResult = await this.planner.createPlan(intentResult, context, rawInput);
    }
    
    // 2. Execute the plan
    const executionResults = await this.decisionEngine.executePlan(planResult);
    
    // 3. Format the final response
    const response = await this.responseFormatter.format(intentResult, executionResults);

    return {
      type: 'tool',
      data: response
    };
  }
}
