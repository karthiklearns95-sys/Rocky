import { exec } from 'child_process';
import config from '../../config/app.config.js';

/**
 * Tool to open Google Chrome with a specific user profile.
 * @param {Object} args - { profileName: string }
 */
export default async function openChromeProfile(args) {
  const profile = args.profileName || config.defaultChromeProfile;
  console.log(`[Tool: openChromeProfile] Opening Chrome with profile: "${profile}"`);
  
  // Windows Chrome path (common location)
  const chromePath = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`;
  
  return new Promise((resolve) => {
    // --profile-directory expects the internal profile directory name (e.g., "Default", "Profile 1")
    // but users often provide the display name. 
    // For now, we'll pass it as provided.
    const command = `${chromePath} --profile-directory="${profile}"`;
    
    exec(command, (error) => {
      if (error) {
        console.error(`[Tool: openChromeProfile] Error:`, error);
        return resolve(`Grace... Rocky tried to open Chrome with profile "${profile}" but something went wrong.`);
      }
      resolve(`Grace, Rocky is opening Chrome with your "${profile}" profile. Amaze.`);
    });
  });
}
