import ToolManager from '#tools/toolManager.js';
import { execWithTimeout } from '../automation/system/execWithTimeout.js';
import path from 'path';
import fs from 'fs';

// Modular Tools
import openChromeProfile from '#tools/system/openChromeProfile.js';
import createFileWithContent from '#tools/system/createFileWithContent.js';
import openFile from '#tools/system/openFile.js';
import calculate from '#tools/system/calculate.js';
import openFolder from '#tools/system/openFolder.js';
import { mouseClick, typeText, pressKey, scroll, focusWindow } from '#tools/system/guiControl.js';
import locateUIElement from '#tools/system/locateUIElement.js';
import sendEmailDirect from '#tools/system/sendEmailDirect.js';
import openResource from '#tools/system/openResource.js';
import takeScreenshot from '#tools/system/takeScreenshot.js';
import waitForAppReady from '#tools/system/waitForAppReady.js';
import webSearch from '#tools/system/webSearch.js';
import fetchAPI from '#tools/system/fetchAPI.js';
import analyze_ui from '#tools/system/analyzeUI.js';
import ocrSearch from '#tools/system/ocrSearch.js';
import { openURL as browserOpen, browserClick, browserType, browserRead } from '#tools/browser/browserController.js';
import { desktopClick, desktopType } from '#tools/desktop/desktopController.js';

const toolManager = new ToolManager();

// --- Registration (Mistake-Free Pass) ---

// 1. App & System
toolManager.registerTool('open_resource', openResource);
toolManager.registerTool('focusWindow', focusWindow);
toolManager.registerTool('waitForAppReady', waitForAppReady);
toolManager.registerTool('openFolder', openFolder);
toolManager.registerTool('openChromeProfile', openChromeProfile);
toolManager.registerTool('systemControl', async (args) => {
  // Simple system control logic remains here for now
  const action = String(args.action || '');
  let cmd = '';
  if (action.includes('up')) cmd = `powershell -NoProfile -NonInteractive -Command "$w = New-Object -ComObject WScript.Shell; for($i=0;$i-lt 5;$i++){$w.SendKeys([char]175)}"`;
  else if (action.includes('down')) cmd = `powershell -NoProfile -NonInteractive -Command "$w = New-Object -ComObject WScript.Shell; for($i=0;$i-lt 5;$i++){$w.SendKeys([char]174)}"`;
  else if (action.includes('mute')) cmd = `powershell -NoProfile -NonInteractive -Command "$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]173)"`;

  if (!cmd) return { success: false, error: "Rocky doesn't know that system command." };
  const { timedOut, error } = await execWithTimeout(cmd, { timeoutMs: 5000 });
  if (timedOut || error) return { success: false, error: `Rocky could not adjust the system: ${error?.message || 'timed out'}` };
  return { success: true, data: `Rocky adjusted the system. Amaze.` };
});

// 2. Files
toolManager.registerTool('createFileWithContent', createFileWithContent);
toolManager.registerTool('openFile', openFile);
toolManager.registerTool('searchFiles', async (args) => {
  const { query } = args;
  if (!query) return { success: false, error: 'Rocky needs a file name to search for.' };
  // query comes from the LLM — pass it via env so quotes/$()/%VAR% can't escape the -Filter argument.
  const psCmd = `powershell -NoProfile -NonInteractive -Command "Get-ChildItem -Path $HOME -Filter ('*' + $env:ROCKY_SEARCH_QUERY + '*') -Recurse -ErrorAction SilentlyContinue | Select-Object -First 5 -Property Name, FullName | ConvertTo-Json"`;
  const { stdout, timedOut, error } = await execWithTimeout(psCmd, { timeoutMs: 20000, env: { ROCKY_SEARCH_QUERY: String(query) } });
  if (timedOut) return { success: false, error: `Rocky's search for "${query}" took too long.` };
  if (error || !stdout.trim()) return { success: false, error: `Rocky found no files matching "${query}".` };
  try {
    const results = JSON.parse(stdout);
    const list = Array.isArray(results) ? results : [results];
    return { success: true, data: `Rocky found: ${list.map(f => f.Name).join(', ')}. Should I open one?` };
  } catch (e) { return { success: true, data: `Rocky found files but they are hiding. Amaze.` }; }
});

// 3. Automation
toolManager.registerTool('takeScreenshot', takeScreenshot);
toolManager.registerTool('mouseClick', mouseClick);
toolManager.registerTool('typeText', typeText);
toolManager.registerTool('pressKey', pressKey);
toolManager.registerTool('scroll', scroll);
toolManager.registerTool('locateUIElement', locateUIElement);
toolManager.registerTool('analyze_ui', analyze_ui);

// 4. Intelligence & Web
toolManager.registerTool('calculate', calculate);
toolManager.registerTool('webSearch', webSearch);
toolManager.registerTool('fetchAPI', fetchAPI);
toolManager.registerTool('ocrSearch', ocrSearch);


// 5. Communication
toolManager.registerTool('sendEmailDirect', sendEmailDirect);

// 6. Browser Automation (Playwright)
toolManager.registerTool('browserOpen', browserOpen);
toolManager.registerTool('browserClick', browserClick);
toolManager.registerTool('browserType', browserType);
toolManager.registerTool('browserRead', browserRead);

// 7. Native Desktop Automation (UIA)
toolManager.registerTool('desktopClick', desktopClick);
toolManager.registerTool('desktopType', desktopType);

export default toolManager;
