import { execWithTimeout } from '../../automation/system/execWithTimeout.js';

/**
 * Web Search Tool — opens a browser search safely.
 *
 * Fixed: replaced callback-style bare exec() with execWithTimeout (8s deadline).
 * Also escapes single quotes in the query before PowerShell interpolation.
 */
export default async function webSearch(args) {
  const { query } = args;
  if (!query) return { success: false, error: 'Grace, Rocky needs a query to search.' };

  console.log(`[Tool: webSearch] Searching for: ${query}`);

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  // Escape single quotes for PowerShell string interpolation
  const escapedUrl = searchUrl.replace(/'/g, "''");
  const psCommand  = `powershell -NoProfile -Command "Start-Process '${escapedUrl}'"`;

  const { timedOut, error } = await execWithTimeout(psCommand, { timeoutMs: 8000 });

  if (timedOut) {
    console.warn('[Tool: webSearch] Browser launch timed out.');
    return { success: false, error: "Rocky timed out trying to open the browser." };
  }
  if (error) {
    console.error('[Tool: webSearch] Error:', error);
    return { success: false, error: "Rocky couldn't open the search." };
  }

  return { success: true, data: `Rocky searched for "${query}". Amaze.` };
}
