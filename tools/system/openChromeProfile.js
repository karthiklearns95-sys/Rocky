import { execWithTimeout } from '../../automation/system/execWithTimeout.js';
import config from '../../config/app.config.js';

/**
 * Tool to open Google Chrome with a specific user profile.
 *
 * Fixed: replaced callback-style bare exec() with execWithTimeout (10s deadline).
 * Chrome launch occasionally stalls on profile migration dialogs.
 */
export default async function openChromeProfile(args) {
  const profile = args.profileName || config.defaultChromeProfile;
  console.log(`[Tool: openChromeProfile] Opening Chrome with profile: "${profile}"`);

  // Escape double-quotes in profile name for the command string
  const escapedProfile = String(profile).replace(/"/g, '\\"');
  const chromePath = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`;
  const command    = `${chromePath} --profile-directory="${escapedProfile}"`;

  const { timedOut, error } = await execWithTimeout(command, { timeoutMs: 10000 });

  if (timedOut) {
    return `Grace… Rocky timed out trying to open Chrome with profile "${profile}".`;
  }
  if (error) {
    console.error('[Tool: openChromeProfile] Error:', error);
    return `Grace… Rocky tried to open Chrome with profile "${profile}" but something went wrong.`;
  }

  return `Grace, Rocky is opening Chrome with your "${profile}" profile. Amaze.`;
}
