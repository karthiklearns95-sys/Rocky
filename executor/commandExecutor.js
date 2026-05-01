import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export default class CommandExecutor {
  constructor(permissionManager) {
    this.permissionManager = permissionManager;
  }

  async execute(command) {
    console.log(`[CommandExecutor] Attempting to run: ${command}`);
    
    const perm = this.permissionManager.isAllowed(command);
    if (!perm.allowed) {
      console.warn(`[CommandExecutor] Blocked: ${perm.reason}`);
      throw new Error(`Permission denied: ${perm.reason}`);
    }

    try {
      const { stdout, stderr } = await execPromise(command);
      if (stderr && stderr.length > 0) {
        console.warn(`[CommandExecutor] Executed with warnings: ${stderr}`);
      }
      return stdout.trim();
    } catch (error) {
      console.error(`[CommandExecutor] Execution failed: ${error.message}`);
      throw error;
    }
  }
}
