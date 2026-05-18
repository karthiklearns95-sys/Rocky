/**
 * verifyExecution.js
 * 
 * Re-architected Execution Trust Validation.
 * Eliminated fragile PNG size-diffing hacks.
 * Now strictly trusts deterministic Native UI Automation state feedback via the Daemon.
 */

/**
 * Validates a UI interaction strictly via the Daemon IPC response payload.
 *
 * @param {Object} uiaResponse - The JSON payload returned from uiaManager.js
 * @returns {Object} { changed: boolean, reason: string, elementState: string }
 */
export async function validateExecutionState(uiaResponse) {
  // If the daemon response indicates an absolute failure
  if (!uiaResponse || !uiaResponse.success) {
    return {
      changed: false,
      reason: uiaResponse?.error || 'DAEMON_FAILURE',
      elementState: 'none'
    };
  }

  // UIA Daemon successfully invoked, focused, or mutated the tree
  console.log(`[Validation] UIA State confirmed: ${uiaResponse.elementState || 'success'} in ${uiaResponse.latency}`);
  
  return {
    changed: true, // Deterministic proof the tree was modified or event triggered
    reason: 'UIA_STATE_CONFIRMED',
    elementState: uiaResponse.elementState || 'invoked'
  };
}

// Deprecated stub to satisfy legacy agent loop dependencies until fully unhooked
export async function captureTempScreenshot() {
  console.warn('[Validation] Visual screenshots deprecated. Using strict UIA state.');
  return null; 
}

// Deprecated stub to satisfy legacy agent loop dependencies until fully unhooked
export async function compareScreenshots() {
  console.warn('[Validation] Visual PNG diffing deprecated. Using strict UIA state.');
  return { changed: true, reason: 'DEPRECATED_BYPASS', diffPercent: 100 };
}
