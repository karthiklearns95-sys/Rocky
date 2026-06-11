import { parentPort } from 'worker_threads';
import LocalProvider from '../aiProvider/localProvider.js';
import WorkflowPlanner from '../planner/workflowPlanner.js';
import UserMemory from '#memory/userMemory.js';
import { buildPlannerContext } from '#memory/contextManager.js';
import toolManager from '#tools/index.js';

// Headless Cognitive Pipeline for Delegation
// Uses the dedicated coding model
const aiProvider = new LocalProvider('qwen2.5-coder');
const planner = new WorkflowPlanner(aiProvider);
const userMemory = new UserMemory(aiProvider);

parentPort.on('message', async (taskPayload) => {
    try {
        console.log(`[WorkerAgent] 🧬 Headless clone awakened for task: ${taskPayload.trigger || 'delegated_task'}`);
        let syntheticPrompt = taskPayload.prompt || `Process background task: ${taskPayload.trigger}`;

        // Strict Context Bouncer
        const strictContext = await buildPlannerContext(syntheticPrompt, 'worker-session', aiProvider);

        // Run Planner in headless mode
        const plan = await planner.createPlan(syntheticPrompt, {}, toolManager.list(), 1, strictContext, {});

        // Execute Tools physically
        let executionLog = [];
        if (plan && plan.steps) {
            for (const step of plan.steps) {
                console.log(`[WorkerAgent] Executing step: ${step.action}`);
                if (toolManager.has(step.action)) {
                    const result = await toolManager.execute(step.action, step.args);
                    executionLog.push({ step: step.action, result });
                } else {
                    console.log(`[WorkerAgent] Tool ${step.action} not found. Skipping.`);
                }
            }
        }
        
        parentPort.postMessage({ 
            status: 'success', 
            data: { 
                processed: true, 
                planSteps: plan?.steps?.length || 0,
                executionLog,
                message: `Headless cognitive task completed.`
            } 
        });
    } catch (e) {
        console.error(`[WorkerAgent] ❌ Error:`, e);
        parentPort.postMessage({ status: 'error', error: e.message });
    }
});
