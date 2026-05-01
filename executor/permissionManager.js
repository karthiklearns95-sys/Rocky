export default class PermissionManager {
  constructor() {
    this.allowedCommands = [
      'echo', 'dir', 'ls', 'whoami', 'date'
    ];
  }

  isAllowed(command) {
    const baseCommand = command.split(' ')[0].toLowerCase();
    
    // In a real system, we'd prompt the user for unknown/destructive commands
    // For now, we allow basic safe commands and block the rest
    if (this.allowedCommands.includes(baseCommand)) {
      return { allowed: true };
    }
    
    return { allowed: false, reason: `Command "${baseCommand}" requires manual approval.` };
  }
}
