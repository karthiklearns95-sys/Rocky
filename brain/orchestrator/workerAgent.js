import { parentPort } from 'worker_threads';
import LocalProvider from '../aiProvider/localProvider.js';
import WorkflowPlanner from '../planner/workflowPlanner.js';
import UserMemory from '#memory/userMemory.js';
import { buildPlannerContext } from '#memory/contextManager.js';

// Headless Cognitive Pipeline (No UIA/Desktop automation)
const aiProvider = new LocalProvider('mistral');
const planner = new WorkflowPlanner(aiProvider);
const userMemory = new UserMemory(aiProvider);


parentPort.on('message', async (taskPayload) => {
    try {
        let syntheticPrompt = "";
        
        if (taskPayload.trigger === 'file_added') {
            syntheticPrompt = `System Alert: A new file '${taskPayload.filename}' was added to '${taskPayload.path}'. Analyze it briefly and update the knowledge graph.`;
        } else if (taskPayload.trigger === 'time_event') {
            syntheticPrompt = `System Alert: Scheduled time event triggered for intent: ${taskPayload.intent}. Check if it needs processing.`;
        } else if (taskPayload.trigger === 'self_reflection') {
            // Import and run the Reflection Engine dynamically to avoid circular dependencies if any
            const { reflectionEngine } = await import('#memory/reflectionEngine.js');
            await reflectionEngine.executeSelfReflection();
            
            parentPort.postMessage({ 
                status: 'success', 
                data: { message: `Self-Reflection Night Shift completed successfully.` } 
            });
            return; // Halt further cognitive execution
        } else {
            syntheticPrompt = taskPayload.prompt || `Process background task: ${taskPayload.trigger}`;
        }

        // Strict Context Bouncer
        const strictContext = await buildPlannerContext(syntheticPrompt, 'worker-session', aiProvider);

        // Run Planner in headless mode (no UI mapping)
        const plan = await planner.createPlan(syntheticPrompt, {}, [], 1, strictContext, {});

        // Simulate headless execution of the plan (e.g. data parsing, DB inserts, web scraping)
        // In a full implementation, we'd iterate over plan.steps and execute non-UI tools.
        await new Promise(r => setTimeout(r, 1500));
        
        parentPort.postMessage({ 
            status: 'success', 
            data: { 
                processed: true, 
                planSteps: plan?.steps?.length || 0,
                message: `Headless cognitive task completed for ${taskPayload.trigger}`
            } 
        });
    } catch (e) {
        parentPort.postMessage({ status: 'error', error: e.message });
    }
});
