import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Delegation Manager
 * Dispatches heavy background cognitive tasks to headless Node.js worker clones.
 * Implements a strict thread pool limit to prevent system resource exhaustion.
 */
class DelegationManager {
    constructor(maxWorkers = 3) {
        this.maxWorkers = maxWorkers;
        this.activeWorkers = 0;
        this.queue = [];
        this.workerPath = path.join(__dirname, 'workerAgent.js');
    }

    /**
     * @param {Object} taskPayload The event payload from InitiativeEngine
     * @returns {Promise} Resolves when the worker clone finishes the task
     */
    async dispatchToWorker(taskPayload) {
        return new Promise((resolve, reject) => {
            const task = { payload: taskPayload, resolve, reject };
            if (this.activeWorkers < this.maxWorkers) {
                this._executeTask(task);
            } else {
                this.queue.push(task);
                console.log(`[DelegationManager] Thread pool full. Task queued. Active workers: ${this.activeWorkers}/${this.maxWorkers}`);
            }
        });
    }

    _executeTask(task) {
        this.activeWorkers++;
        console.log(`[DelegationManager] 🧬 Spinning up headless clone. Active threads: ${this.activeWorkers}/${this.maxWorkers}`);

        const worker = new Worker(this.workerPath);
        
        worker.on('message', (message) => {
            if (message.status === 'success') {
                task.resolve(message.data);
            } else {
                task.reject(new Error(message.error));
            }
            worker.terminate();
        });

        worker.on('error', (err) => {
            console.error(`[DelegationManager] ❌ Worker crashed:`, err.message);
            task.reject(err);
            worker.terminate();
        });

        worker.on('exit', (code) => {
            this.activeWorkers--;
            if (code !== 0 && code !== 1) {
                console.warn(`[DelegationManager] Worker stopped with abnormal exit code: ${code}`);
            }
            this._processQueue();
        });

        // Dispatch task to the headless clone
        process.emit('aura_telemetry', { status: 'background_processing', active_workers: this.activeWorkers });
        worker.postMessage(task.payload);
    }

    _processQueue() {
        if (this.activeWorkers === 0) {
            process.emit('aura_telemetry', { status: 'idle' });
        }
        if (this.queue.length > 0 && this.activeWorkers < this.maxWorkers) {
            const nextTask = this.queue.shift();
            this._executeTask(nextTask);
        }
    }
}

export const delegationManager = new DelegationManager();
