import PermissionManager from './permissionManager.js';
import CommandExecutor from './commandExecutor.js';

const permissionManager = new PermissionManager();
const commandExecutor = new CommandExecutor(permissionManager);

export { commandExecutor, permissionManager };
