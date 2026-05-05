import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export default async function waitForAppReady({ appName, maxWaitMs = 5000 }) {
  console.log(`[WaitForAppReady] Waiting up to ${maxWaitMs}ms for ${appName} to stabilize...`);
  
  const startTime = Date.now();
  let found = false;

  // Poll every 500ms
  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Find window by image name or window title
      const { stdout } = await execAsync(`tasklist /fi "imagename eq ${appName}.exe" /nh`);
      if (stdout && stdout.toLowerCase().includes(appName.toLowerCase())) {
        found = true;
        break;
      }
    } catch (e) {
      // ignore
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (found) {
    // Wait an extra 1000ms for UI painting and animations to finish
    await new Promise(r => setTimeout(r, 1000));
    return { success: true, message: `${appName} is ready and stabilized.` };
  } else {
    return { success: false, error: `App ${appName} did not appear within ${maxWaitMs}ms.` };
  }
}
