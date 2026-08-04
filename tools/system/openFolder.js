import { execWithTimeout } from '../../automation/system/execWithTimeout.js';
import open from 'open';

/**
 * openFolder tool — searches for a folder globally and opens it in Explorer.
 *
 * Fixed: replaced callback-style bare exec() with execWithTimeout (12s deadline).
 * A recursive Get-ChildItem over $HOME with no timeout could stall for minutes
 * on large directory trees, network drives, or OneDrive-backed folders.
 */
export default async function openFolder(args) {
  const { folderName } = args;
  if (!folderName) return 'Grace, which folder should Rocky open?';

  console.log(`[Tool: openFolder] Searching for folder: ${folderName}`);

  // Escape single quotes for PowerShell
  const escapedName = String(folderName).replace(/'/g, "''");
  const psCmd =
    `powershell -NoProfile -NonInteractive -Command ` +
    `"Get-ChildItem -Path $HOME -Directory -Filter '*${escapedName}*' ` +
    `-Recurse -ErrorAction SilentlyContinue | ` +
    `Select-Object -First 1 -Property FullName | ConvertTo-Json"`;

  const { stdout, timedOut } = await execWithTimeout(psCmd, { timeoutMs: 12000 });

  // Fallback: try opening the name directly if PS search failed or timed out
  if (timedOut || !stdout || !stdout.trim()) {
    try {
      await open(folderName);
      return `Rocky opened the folder "${folderName}" for you. Amaze.`;
    } catch {
      return `Grace… Rocky searched everywhere but cannot find a folder named "${folderName}".`;
    }
  }

  try {
    const result = JSON.parse(stdout);
    const fullPath = result.FullName;
    console.log(`[Tool: openFolder] Found folder: ${fullPath}`);
    await open(fullPath);
    return `Rocky found and opened the "${folderName}" folder at ${fullPath}. Amaze.`;
  } catch {
    return `Grace, Rocky found the folder but had trouble opening it.`;
  }
}
