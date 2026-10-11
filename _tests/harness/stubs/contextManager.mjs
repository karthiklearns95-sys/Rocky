const T = () => globalThis.__T;
export async function buildPlannerContext(prompt) { T().main('planner.context', String(prompt).slice(0, 60)); return 'PLANNER_CONTEXT'; }
