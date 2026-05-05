import ToolManager from './toolManager.js';
import path from 'path';
import fs from 'fs';

// Modular Tools
import openChromeProfile from './system/openChromeProfile.js';
import createFileWithContent from './system/createFileWithContent.js';
import openFile from './system/openFile.js';
import calculate from './system/calculate.js';
import openFolder from './system/openFolder.js';
import { mouseClick, typeText, pressKey, scroll, focusWindow } from './system/guiControl.js';
import locateUIElement from './system/locateUIElement.js';
import sendEmailDirect from './system/sendEmailDirect.js';
import openResource from './system/openResource.js';
import takeScreenshot from './system/takeScreenshot.js';
import waitForAppReady from './system/waitForAppReady.js';
import webSearch from './system/webSearch.js';
import fetchAPI from './system/fetchAPI.js';

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
  const { action } = args;
  const { exec } = await import('child_process');
  return new Promise((resolve) => {
    let cmd = '';
    if (action.includes('up')) cmd = `powershell -Command "$w = New-Object -ComObject WScript.Shell; for($i=0;$i-lt 5;$i++){$w.SendKeys([char]175)}"`;
    else if (action.includes('down')) cmd = `powershell -Command "$w = New-Object -ComObject WScript.Shell; for($i=0;$i-lt 5;$i++){$w.SendKeys([char]174)}"`;
    else if (action.includes('mute')) cmd = `powershell -Command "$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]173)"`;
    
    if (!cmd) return resolve({ success: false, error: "Rocky doesn't know that system command." });
    exec(cmd, () => resolve({ success: true, data: `Rocky adjusted the system. Amaze.` }));
  });
});

// 2. Files
toolManager.registerTool('createFileWithContent', createFileWithContent);
toolManager.registerTool('openFile', openFile);
toolManager.registerTool('searchFiles', async (args) => {
  const { query } = args;
  const { exec } = await import('child_process');
  const psCmd = `powershell -NoProfile -NonInteractive -Command "Get-ChildItem -Path $HOME -Filter '*${query}*' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 5 -Property Name, FullName | ConvertTo-Json"`;
  return new Promise((resolve) => {
    exec(psCmd, (err, stdout) => {
      if (err || !stdout) return resolve({ success: false, error: `Rocky found no files matching "${query}".` });
      try {
        const results = JSON.parse(stdout);
        const list = Array.isArray(results) ? results : [results];
        resolve({ success: true, data: `Rocky found: ${list.map(f => f.Name).join(', ')}. Should I open one?` });
      } catch (e) { resolve({ success: true, data: `Rocky found files but they are hiding. Amaze.` }); }
    });
  });
});

// 3. Automation
toolManager.registerTool('takeScreenshot', takeScreenshot);
toolManager.registerTool('mouseClick', mouseClick);
toolManager.registerTool('typeText', typeText);
toolManager.registerTool('pressKey', pressKey);
toolManager.registerTool('scroll', scroll);
toolManager.registerTool('locateUIElement', locateUIElement);

// 4. Intelligence & Web
toolManager.registerTool('calculate', calculate);
toolManager.registerTool('webSearch', webSearch);
toolManager.registerTool('fetchAPI', fetchAPI);

// 5. Communication
toolManager.registerTool('sendEmailDirect', sendEmailDirect);

export default toolManager;
