import { exec } from 'child_process';

/**
 * Open URL Tool - Safe navigation to a specific URL.
 */
export default async function openURL(args) {
  const { url } = args;
  if (!url) return { success: false, error: "Grace, Rocky needs a URL to open." };

  console.log(`[Tool: openURL] Opening: ${url}`);

  // Validate URL protocol to prevent execution of local files or arbitrary protocols
  let safeUrl = url;
  if (!safeUrl.startsWith('http://') && !safeUrl.startsWith('https://')) {
    safeUrl = 'https://' + safeUrl;
  }

  const psCommand = `powershell -Command "Start-Process '${safeUrl}'"`;

  return new Promise((resolve) => {
    exec(psCommand, (error) => {
      if (error) {
        console.error(`[Tool: openURL] Error:`, error);
        return resolve({ success: false, error: "Rocky couldn't open the URL." });
      }
      resolve({ success: true, data: `Rocky opened ${safeUrl}. Amaze.` });
    });
  });
}
