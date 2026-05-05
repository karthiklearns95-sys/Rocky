import { exec } from 'child_process';
import open from 'open';

/**
 * openFolder tool — searches for a folder globally and opens it in Explorer.
 */
export default async function openFolder(args) {
  const { folderName } = args;
  if (!folderName) return "Grace, which folder should Rocky open?";

  console.log(`[Tool: openFolder] Searching for folder: ${folderName}`);

  // PowerShell to find the folder in the user profile
  const psCmd = `powershell -NoProfile -NonInteractive -Command "Get-ChildItem -Path $HOME -Directory -Filter '*${folderName}*' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -Property FullName | ConvertTo-Json"`;

  return new Promise((resolve) => {
    exec(psCmd, async (error, stdout) => {
      if (error || !stdout || stdout.trim() === "") {
        // Fallback: Just try opening it directly if it might be a relative path
        try {
          await open(folderName);
          return resolve(`Rocky opened the folder "${folderName}" for you. Amaze.`);
        } catch {
          return resolve(`Grace... Rocky searched everywhere but cannot find a folder named "${folderName}".`);
        }
      }

      try {
        const result = JSON.parse(stdout);
        const fullPath = result.FullName;
        
        console.log(`[Tool: openFolder] Found folder: ${fullPath}`);
        await open(fullPath);
        resolve(`Rocky found and opened the "${folderName}" folder at ${fullPath}. Amaze.`);
      } catch (e) {
        resolve(`Grace, Rocky found the folder but had trouble opening it. Path: ${stdout}`);
      }
    });
  });
}
