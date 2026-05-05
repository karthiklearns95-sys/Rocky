import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import open from 'open';

/**
 * Universal App Opener (App-Agnostic)
 * Only handles the mechanical act of launching a process or URL.
 * Mapping and logic are handled by the Brain (AppActionMapper).
 */
export default async function openApp(args) {
  const appName = args.appName?.toLowerCase().trim();
  if (!appName) return "Grace, what app should Rocky open?";

  console.log(`[Tool: openApp] Launching: ${appName}`);

  // 1. Check for system-recognized apps via 'where' or 'Get-StartApps'
  const appMap = {
    'chrome': 'chrome',
    'google': 'chrome',
    'firefox': 'firefox',
    'vscode': 'code',
    'vs code': 'code',
    'notepad': 'notepad',
    'calculator': 'calc',
    'terminal': 'wt',
  };
  
  const target = appMap[appName] || appName;

  return new Promise((resolve) => {
    // Try PowerShell Start-Process (most robust for Windows Apps)
    const psCmd = `powershell -NoProfile -NonInteractive -Command "$app = Get-StartApps | Where-Object { $_.Name -like '*${target}*' } | Select-Object -First 1; if ($app) { Start-Process ('shell:AppsFolder\\' + $app.AppID); Write-Output 'found' } else { Write-Output 'notfound' }"`;
    
    exec(psCmd, (psErr, psOut) => {
      if (!psErr && psOut && psOut.trim().includes('found')) {
        return resolve(`Rocky launched ${appName}. Amaze.`);
      }

      // Fallback: Try directly running the command
      exec(`start ${target}`, (err) => {
        if (err) {
          console.log(`[Tool: openApp] Local launch failed for ${target}. Trying browser fallback...`);
          
          // Aggressive Fallback: If not an app, it MUST be a website
          const url = target.includes('.') ? target : `${target}.com`;
          const finalUrl = url.startsWith('http') ? url : `https://${url}`;
          
          console.log(`[Tool: openApp] Opening URL: ${finalUrl}`);
          open(finalUrl);
          return resolve(`Rocky opened ${appName} in the browser. Amaze.`);
        }
        resolve(`Rocky launched ${appName}. Amaze.`);
      });
    });
  });
}
