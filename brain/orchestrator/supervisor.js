import eventBus from '../../services/eventBus.js';
import { uiaManager } from '../../tools/desktop/uiaManager.js';
import process from 'process';

/**
 * Autonomic Supervisor
 * Hooked directly into the OS execution daemon to detect focus stealing,
 * unexpected system modals, or physical human interruption.
 * Reflexively pauses the queue, restores execution state, and resumes.
 */
class Supervisor {
    constructor() {
        this.isPaused = false;
        this.resumeCallback = null;

        // Bind to out-of-band anomalies from UIA Manager
        eventBus.on('execution:anomaly', async (anomaly) => {
            await this.handleAnomaly(anomaly);
        });
    }

    /**
     * Called by the execution loop to block progress if an anomaly is active.
     */
    async waitUntilResumed() {
        if (!this.isPaused) return;
        return new Promise(resolve => {
            this.resumeCallback = resolve;
        });
    }

    pause() {
        console.warn(`[Supervisor] ⏸️ Execution queue PAUSED due to OS anomaly.`);
        this.isPaused = true;
    }

    resume() {
        console.log(`[Supervisor] ▶️ Anomaly resolved. Execution queue RESUMED.`);
        this.isPaused = false;
        if (this.resumeCallback) {
            this.resumeCallback();
            this.resumeCallback = null;
        }
    }

    async handleAnomaly(anomaly) {
        if (anomaly.event === 'human_intervention') {
            console.error(`[Supervisor] 🚨 PHYSICAL INTERRUPTION DETECTED (Mouse Drift > 50px)`);
            console.error(`[Supervisor] Firing Global Kill Switch!`);
            // Emits an abort signal that halts all orchestrator pipelines
            process.emit('aura_telemetry', { status: 'interrupted', reason: 'human_override' });
            eventBus.emit('execution:abort');
            return;
        }

        if (this.isPaused) return; // Prevent cascading pauses
        this.pause();

        try {
            console.warn(`[Supervisor] Evaluating anomaly: ${anomaly.event} (Focus hijacked by: ${anomaly.newFocus})`);

            if (anomaly.event === 'focus_lost') {
                console.log(`[Supervisor] 🛡️ Force-restoring focus to automated application...`);
                // Ask daemon to forcefully restore the original window handle
                await uiaManager.runCommand('restore_focus', 'system');
                await new Promise(r => setTimeout(r, 500));
                this.resume();
            } 
            else if (anomaly.event === 'modal_popup') {
                console.log(`[Supervisor] 🛡️ Modal detected. Attempting fast-path visual closure...`);
                // Try to find an exit button visually to kill the popup
                const { perceptionEngine } = await import('../../vision/perceptionEngine.js');
                const targets = ['Close', 'X', 'Cancel', 'Dismiss', 'OK'];
                
                let closed = false;
                for (const t of targets) {
                    const bbox = await perceptionEngine.locateTextOnScreen(t);
                    if (bbox) {
                        const targetX = Math.floor(bbox.x + bbox.width / 2);
                        const targetY = Math.floor(bbox.y + bbox.height / 2);
                        console.log(`[Supervisor] Visually located modal dismiss button "${t}". Firing intercept click.`);
                        await uiaManager.runCommand('hard_click', t, '', JSON.stringify({ x: targetX, y: targetY }));
                        closed = true;
                        break;
                    }
                }
                
                if (!closed) {
                   console.log(`[Supervisor] Could not visually resolve modal. Assuming it's a notification, restoring focus.`);
                   await uiaManager.runCommand('restore_focus', 'system');
                }

                await new Promise(r => setTimeout(r, 500)); // allow OS settle time
                this.resume();
            } else {
                this.resume();
            }
        } catch (e) {
            console.error(`[Supervisor] Reflex arc failed to handle anomaly:`, e.message);
            this.resume(); // attempt to trudge on
        }
    }
}

export const supervisor = new Supervisor();
