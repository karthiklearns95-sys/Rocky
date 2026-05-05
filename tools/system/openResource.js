import { exec } from 'child_process';

/**
 * Unified Open Resource Tool
 * Opens desktop apps, web URLs, or hybrid apps — all without hardcoding.
 *
 * Expected args shape (injected by AgentLoop before execution):
 *   { query: string, resource: { type, target, fallback?, confidence } }
 */
export default async function openResource(args) {
  const { resource } = args;

  if (!resource || !resource.type) {
    return { success: false, error: 'open_resource: resource was not resolved before execution.' };
  }

  console.log(`[Tool: open_resource] type=${resource.type} target=${resource.target}`);

  const launch = (cmd) =>
    new Promise((resolve) => {
      exec(cmd, (err) => {
        if (err) {
          console.error(`[Tool: open_resource] exec error:`, err.message);
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true });
        }
      });
    });

  if (resource.type === 'desktop') {
    // UWP packages contain '!' in their AppID; win32 exes don't.
    const cmd = resource.target.includes('!')
      ? `powershell -Command "Start-Process 'shell:AppsFolder\\${resource.target}' -ErrorAction Stop"`
      : `powershell -Command "Start-Process '${resource.target}' -ErrorAction Stop"`;
    return launch(cmd);
  }

  if (resource.type === 'web') {
    const url = resource.target.startsWith('http') ? resource.target : `https://${resource.target}`;
    return launch(`powershell -Command "Start-Process '${url}'"`);
  }

  if (resource.type === 'hybrid') {
    // Try desktop first; fall back to web URL if provided.
    const desktopCmd = resource.target.includes('!')
      ? `powershell -Command "Start-Process 'shell:AppsFolder\\${resource.target}' -ErrorAction Stop"`
      : `powershell -Command "Start-Process '${resource.target}' -ErrorAction Stop"`;

    const desktopResult = await launch(desktopCmd);
    if (desktopResult.success) return desktopResult;

    if (resource.fallback) {
      console.log(`[Tool: open_resource] Desktop failed — falling back to web: ${resource.fallback}`);
      const url = resource.fallback.startsWith('http') ? resource.fallback : `https://${resource.fallback}`;
      return launch(`powershell -Command "Start-Process '${url}'"`);
    }

    return { success: false, error: `Could not open hybrid resource: ${resource.target}` };
  }

  return { success: false, error: `Unknown resource type: ${resource.type}` };
}
