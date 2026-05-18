import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * The Initiative Engine
 * Gives Rocky internal proactivity by monitoring environmental OS events
 * and time-based schedules, then safely injecting synthetic triggers 
 * into the Agent Loop without interrupting human workflows.
 */
class InitiativeEngine {
    constructor() {
        this.watchers = [];
        this.tickInterval = null;
        this.agentLoopInstance = null;
        this.seenFiles = new Set();
    }

    start(agentLoopInstance) {
        this.agentLoopInstance = agentLoopInstance;
        console.log(`[InitiativeEngine] 🌟 Starting background observers...`);
        this._setupFileSystemObservers();
        this._setupTimeObservers();
    }

    stop() {
        for (const w of this.watchers) w.close();
        if (this.tickInterval) clearInterval(this.tickInterval);
        console.log(`[InitiativeEngine] Observers shut down.`);
    }

    _setupFileSystemObservers() {
        const home = os.homedir();
        const targets = [
            path.join(home, 'Downloads'),
            path.join(home, 'Desktop')
        ];

        targets.forEach(dir => {
            if (fs.existsSync(dir)) {
                try {
                    const watcher = fs.watch(dir, (eventType, filename) => {
                        if (eventType === 'rename' && filename) {
                            const fullPath = path.join(dir, filename);
                            
                            // Check if file genuinely exists (avoids deletion events)
                            if (fs.existsSync(fullPath) && !this.seenFiles.has(fullPath)) {
                                this.seenFiles.add(fullPath);
                                // Deduplicate repeated OS events for the same file
                                setTimeout(() => this.seenFiles.delete(fullPath), 15000);
                                
                                const ext = path.extname(filename).toLowerCase();
                                // Monitor meaningful documents and media
                                if (['.pdf', '.csv', '.docx', '.txt', '.png', '.jpg'].includes(ext)) {
                                    this._fireTrigger({
                                        trigger: 'file_added',
                                        path: fullPath,
                                        filename,
                                        type: 'document'
                                    });
                                }
                            }
                        }
                    });
                    this.watchers.push(watcher);
                    console.log(`[InitiativeEngine] 👀 Watching directory: ${dir}`);
                } catch (e) {
                    console.warn(`[InitiativeEngine] Failed to watch ${dir}:`, e.message);
                }
            }
        });
    }

    _setupTimeObservers() {
        // Tick every 60 seconds
        this.tickInterval = setInterval(() => {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();

            // Example: Daily habit triggered at exactly 17:00 (5:00 PM)
            if (hours === 17 && minutes === 0) {
                this._fireTrigger({
                    trigger: 'time_event',
                    intent: 'daily_cleanup'
                });
            }

            // 🌙 The Night Shift: Autonomic Self-Reflection (runs strictly at 2:00 AM)
            if (hours === 2 && minutes === 0) {
                this._fireTrigger({
                    trigger: 'self_reflection',
                    intent: 'night_shift'
                });
            }
        }, 60000);
    }

    _fireTrigger(payload) {
        if (!this.agentLoopInstance) return;
        console.log(`[InitiativeEngine] 🎯 Proactive trigger fired:`, payload.trigger);
        
        // Pass strictly to the orchestrator for safe queueing
        this.agentLoopInstance.handleProactiveTrigger(payload).catch(e => {
            console.error(`[InitiativeEngine] Failed to inject trigger:`, e.message);
        });
    }
}

export const initiativeEngine = new InitiativeEngine();
