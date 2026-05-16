import { taskRegistry } from './taskRegistry.js';

/**
 * executionGuard.js
 * 
 * Provides wrappers to make any Promise or async function abortable,
 * even if the underlying API does not natively support AbortSignals.
 */

export class AbortError extends Error {
  constructor(message = 'Execution aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

/**
 * Wraps a promise, instantly throwing an AbortError if the signal fires.
 * Also registers the task in the TaskRegistry.
 */
export function withGuard(promise, signal, taskType = 'generic_task') {
  const unregister = taskRegistry.register(taskType);
  
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      unregister();
      return reject(new AbortError(signal.reason));
    }

    const abortHandler = () => {
      unregister();
      reject(new AbortError(signal.reason));
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    promise
      .then(result => {
        if (!signal?.aborted) resolve(result);
      })
      .catch(error => {
        if (!signal?.aborted) reject(error);
      })
      .finally(() => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
        unregister();
      });
  });
}
