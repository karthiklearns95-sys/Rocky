import { execWithTimeout } from '../automation/system/execWithTimeout.js';

/**
 * CommandExecutor
 *
 * Executes shell commands after permission check.
 *
 * Fixed: replaced util.promisify(exec) (no timeout) with execWithTimeout.
 * Default timeout: 30 seconds. Commands that exceed this are killed and
 * the caller receives a clear TimeoutError instead of hanging indefinitely.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

export default class CommandExecutor {
  constructor(permissionManager) {
    this.permissionManager = permissionManager;
  }

  async execute(command, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    console.log(`[CommandExecutor] Attempting to run: ${command}`);

    const perm = this.permissionManager.isAllowed(command);
    if (!perm.allowed) {
      console.warn(`[CommandExecutor] Blocked: ${perm.reason}`);
      throw new Error(`Permission denied: ${perm.reason}`);
    }

    const { stdout, stderr, timedOut, error } = await execWithTimeout(command, { timeoutMs });

    if (timedOut) {
      const msg = `Command timed out after ${timeoutMs}ms: ${command.substring(0, 80)}`;
      console.error(`[CommandExecutor] ${msg}`);
      throw new Error(msg);
    }

    if (error) {
      console.error(`[CommandExecutor] Execution failed: ${error.message}`);
      throw error;
    }

    if (stderr && stderr.length > 0) {
      console.warn(`[CommandExecutor] Executed with warnings: ${stderr}`);
    }

    return stdout.trim();
  }
}
