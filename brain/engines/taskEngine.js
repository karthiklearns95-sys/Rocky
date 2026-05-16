/**
 * TaskEngine: Handles planning and multi-step workflows.
 */
export default class TaskEngine {
  constructor(planner, decisionEngine, responseFormatter) {
    this.planner = planner;
    this.decisionEngine = decisionEngine;
    this.responseFormatter = responseFormatter;
  }

  async handle(intentResult, context, rawInput) {
    // For now, TaskEngine uses a similar flow to CommandEngine but is reserved for 
    // more complex, multi-step planning tasks.
    const planResult = await this.planner.createPlan(intentResult, context, rawInput);
    const executionResults = await this.decisionEngine.executePlan(planResult);
    const response = await this.responseFormatter.format(intentResult, executionResults);

    return {
      type: 'plan',
      data: response
    };
  }
}
