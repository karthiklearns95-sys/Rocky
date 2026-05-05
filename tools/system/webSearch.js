import { exec } from 'child_process';

/**
 * Web Search Tool - Performs a safe web search using the default browser.
 */
export default async function webSearch(args) {
  const { query } = args;
  if (!query) return { success: false, error: "Grace, Rocky needs a query to search." };

  console.log(`[Tool: webSearch] Searching for: ${query}`);

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  
  // Use powershell Start-Process to safely open the default browser without arbitrary code execution
  const psCommand = `powershell -Command "Start-Process '${searchUrl}'"`;

  return new Promise((resolve) => {
    exec(psCommand, (error) => {
      if (error) {
        console.error(`[Tool: webSearch] Error:`, error);
        return resolve({ success: false, error: "Rocky couldn't open the search." });
      }
      resolve({ success: true, data: `Rocky searched for ${query}. Amaze.` });
    });
  });
}
