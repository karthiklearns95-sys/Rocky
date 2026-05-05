import { execSync } from 'child_process';
import path from 'path';

/**
 * Universal Resource Resolver
 * Resolves an ambiguous query ("spotify") into a physical target and type.
 */
export default async function resolveResource(query, context, appActionMapper = null) {
  const normalizedQuery = query.toLowerCase().trim();

  // 1. Learned Mappings (Memory)
  if (appActionMapper) {
    try {
      const learned = await appActionMapper.mapIntentToAction(`open_${normalizedQuery}`, null);
      if (learned && learned.args && learned.args.preferredType) {
        return {
          type: learned.args.preferredType,
          target: learned.args.target || normalizedQuery,
          confidence: 1.0
        };
      }
    } catch(e) {}
  }

  // 2. Installed Apps (Heuristic Check via PowerShell)
  try {
    const escapedQuery = normalizedQuery.replace(/'/g, "''");
    const psCheck = `powershell -Command "Get-StartApps | Where-Object {$_.Name -match '${escapedQuery}'} | Select-Object -First 1 -ExpandProperty AppID"`;
    const appId = execSync(psCheck, { encoding: 'utf-8' }).trim();
    if (appId) {
      return {
        type: 'desktop',
        target: appId, // For UWP apps, AppID. For win32, executable name.
        confidence: 0.9
      };
    }
  } catch (e) {}

  // Standard Win32 executables heuristics
  const commonExecutables = {
    'notepad': 'notepad.exe',
    'calculator': 'calc.exe',
    'chrome': 'chrome.exe',
    'spotify': 'spotify.exe',
    'vscode': 'code',
    'slack': 'slack.exe',
    'whatsapp': 'whatsapp.exe' // Hybrid
  };

  if (commonExecutables[normalizedQuery]) {
    return {
      type: 'desktop', // Slack/WhatsApp are Electron (hybrid) but OS launches them as desktop
      target: commonExecutables[normalizedQuery],
      confidence: 0.8
    };
  }

  // 3. Web Fallback
  // If it's a known web service or has a TLD
  if (normalizedQuery.includes('.') || ['youtube', 'gmail', 'github'].includes(normalizedQuery)) {
    const targetUrl = normalizedQuery.includes('.') ? normalizedQuery : `https://${normalizedQuery}.com`;
    return {
      type: 'web',
      target: !targetUrl.startsWith('http') ? `https://${targetUrl}` : targetUrl,
      confidence: 0.7
    };
  }

  // Unknown
  return {
    type: 'unknown',
    target: normalizedQuery,
    confidence: 0.1
  };
}
