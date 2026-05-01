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

    // Fast-path: Bypass planner for simple, direct commands like open_app
    if (intentResult.intent === 'open_app' && intentResult.appName) {
      planResult = {
        plan: [`Opening application: ${intentResult.appName}`],
        toolCalls: [
          { toolName: 'openApp', args: { appName: intentResult.appName } }
        ]
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
