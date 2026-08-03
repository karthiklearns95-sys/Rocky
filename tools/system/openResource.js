import { execWithTimeout } from '../../automation/system/execWithTimeout.js';

/**
 * Unified Open Resource Tool
 * Opens desktop apps, web URLs, or hybrid apps — all without hardcoding.
 *
 * Expected args shape (injected by AgentLoop before execution):
 *   { query: string, resource: { type, target, fallback?, confidence } }
 *
 * Security: all user-supplied strings are properly escaped for PowerShell
 * single-quoted strings before interpolation.
 */

/**
 * Escape a string for safe use inside a PowerShell single-quoted string.
 * Single quotes in PS single-quoted strings are escaped by doubling them.
 * This prevents shell injection via resource.target or resource.fallback.
 */
function escapePSArg(str) {
  return String(str || '').replace(/'/g, "''");
}

export default async function openResource(args) {
  const { resource } = args;

  if (!resource || !resource.type) {
    return { success: false, error: 'open_resource: resource was not resolved before execution.' };
  }

  console.log(`[Tool: open_resource] type=${resource.type} target=${resource.target}`);

  /**
   * Launch a PowerShell command with a 15-second timeout.
   * Returns { success, error }.
   */
  const launch = async (cmd) => {
    const { timedOut, error } = await execWithTimeout(cmd, { timeoutMs: 15000 });
    if (timedOut) {
      console.error(`[Tool: open_resource] Launch timed out (>15s): ${cmd.substring(0, 80)}`);
      return { success: false, error: 'Launch timed out — process may have been blocked by UAC or a hang.' };
    }
    if (error) {
      console.error(`[Tool: open_resource] exec error:`, error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  };

  if (resource.type === 'desktop') {
    // UWP packages contain '!' in their AppID; win32 exes don't.
    const safeTarget = escapePSArg(resource.target);
    const cmd = resource.target.includes('!')
      ? `powershell -NoProfile -Command "Start-Process 'shell:AppsFolder\\${safeTarget}' -ErrorAction Stop"`
      : `powershell -NoProfile -Command "Start-Process '${safeTarget}' -ErrorAction Stop"`;
    return launch(cmd);
  }

  if (resource.type === 'web') {
    const url = resource.target.startsWith('http') ? resource.target : `https://${resource.target}`;
    const safeUrl = escapePSArg(url);
    return launch(`powershell -NoProfile -Command "Start-Process '${safeUrl}'"`);
  }

  if (resource.type === 'hybrid') {
    // Try desktop first; fall back to web URL if provided.
    const safeTarget = escapePSArg(resource.target);
    const desktopCmd = resource.target.includes('!')
      ? `powershell -NoProfile -Command "Start-Process 'shell:AppsFolder\\${safeTarget}' -ErrorAction Stop"`
      : `powershell -NoProfile -Command "Start-Process '${safeTarget}' -ErrorAction Stop"`;

    const desktopResult = await launch(desktopCmd);
    if (desktopResult.success) return desktopResult;

    if (resource.fallback) {
      console.log(`[Tool: open_resource] Desktop failed — falling back to web: ${resource.fallback}`);
      const url = resource.fallback.startsWith('http') ? resource.fallback : `https://${resource.fallback}`;
      const safeUrl = escapePSArg(url);
      return launch(`powershell -NoProfile -Command "Start-Process '${safeUrl}'"`);
    }

    return { success: false, error: `Could not open hybrid resource: ${resource.target}` };
  }

  return { success: false, error: `Unknown resource type: ${resource.type}` };
}
