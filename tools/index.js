import ToolManager from './toolManager.js';
import open from 'open';
import screenshot from 'screenshot-desktop';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import pkg from 'duck-duck-scrape';
const { safeSearch } = pkg;

const toolManager = new ToolManager();

// --- 1. Launch Apps ---
toolManager.registerTool('openApp', async (args) => {
  const appName = args.appName.toLowerCase();
  console.log(`[Tool: openApp] Opening: ${appName}`);
  
  try {
    const appMap = {
      'chrome': 'chrome',
      'firefox': 'firefox',
      'vscode': 'code',
      'notepad': 'notepad',
      'calculator': 'calc',
      'spotify': 'spotify',
      'discord': 'discord'
    };

    const target = appMap[appName] || appName;
    await open.app(target).catch(() => open(target));
    return `Rocky opened ${appName} for you, Grace. Amaze.`;
  } catch (error) {
    return `Grace... Rocky failed to open ${appName}. Rocky is sorry.`;
  }
});

// --- 2. Take Screenshot ---
toolManager.registerTool('takeScreenshot', async (args) => {
  console.log(`[Tool: takeScreenshot] Capturing screen...`);
  try {
    const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');
    const filename = `Rocky_Screenshot_${Date.now()}.jpg`;
    const filePath = path.join(desktopPath, filename);
    
    await screenshot({ filename: filePath });
    return `Grace, Rocky saved a screenshot to your desktop. Rocky see everything. Amaze.`;
  } catch (error) {
    return `Grace, Rocky failed to capture screen. Rocky is brave but screen is shy.`;
  }
});

// --- 3. System Control ---
toolManager.registerTool('systemControl', async (args) => {
  const action = args.action.toLowerCase();
  console.log(`[Tool: systemControl] Action: ${action}`);
  
  return new Promise((resolve) => {
    let command = '';
    if (action.includes('volume')) {
      const direction = action.includes('up') ? 'Up' : 'Down';
      command = `powershell -Command "$w = New-Object -ComObject WScript.Shell; for($i=0; $i -lt 5; $i++) { $w.SendKeys([char]17${direction === 'Up' ? '5' : '4'}) }"`;
    } else if (action.includes('mute')) {
      command = `powershell -Command "$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]173)"`;
    }

    if (!command) return resolve("Grace, Rocky doesn't know how to do that yet.");

    exec(command, (error) => {
      if (error) return resolve(`Grace, system resisted Rocky.`);
      resolve(`Grace, Rocky adjusted the system for you. Amaze.`);
    });
  });
});

// --- 4. Search Files ---
toolManager.registerTool('searchFiles', async (args) => {
  const query = args.query.toLowerCase();
  console.log(`[Tool: searchFiles] Searching for: ${query}`);
  
  const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');
  try {
    const files = fs.readdirSync(desktopPath);
    const matched = files.filter(f => f.toLowerCase().includes(query));
    
    if (matched.length > 0) {
      return `Grace, Rocky found ${matched.length} files on your desktop: ${matched.join(', ')}. Rocky see all.`;
    } else {
      return `Grace, Rocky searched the desktop but found nothing matching "${query}".`;
    }
  } catch (error) {
    return `Grace, Rocky failed to read your desktop.`;
  }
});

// --- 5. File Management (Create/Delete/Read) ---
toolManager.registerTool('createFile', async (args) => {
  const { fileName, content = '' } = args;
  console.log(`[Tool: createFile] Creating file: ${fileName}`);
  const filePath = path.join(process.env.USERPROFILE, 'Desktop', fileName);
  
  try {
    fs.writeFileSync(filePath, content);
    return `Grace, Rocky created "${fileName}" on your desktop. Rocky is helpful. Amaze.`;
  } catch (error) {
    return `Grace, Rocky failed to create file.`;
  }
});

toolManager.registerTool('readFile', async (args) => {
  const { fileName } = args;
  console.log(`[Tool: readFile] Reading file: ${fileName}`);
  const filePath = path.join(process.env.USERPROFILE, 'Desktop', fileName);
  
  try {
    if (!fs.existsSync(filePath)) return `Grace, Rocky cannot find "${fileName}".`;
    const content = fs.readFileSync(filePath, 'utf8');
    return `Grace, Rocky read the file. It says: "${content.substring(0, 200)}". Rocky see all.`;
  } catch (error) {
    return `Grace, Rocky failed to read the file.`;
  }
});

toolManager.registerTool('deleteFile', async (args) => {
  const { fileName } = args;
  console.log(`[Tool: deleteFile] Deleting file: ${fileName}`);
  const filePath = path.join(process.env.USERPROFILE, 'Desktop', fileName);
  
  try {
    if (!fs.existsSync(filePath)) return `Grace, Rocky cannot find "${fileName}" to delete.`;
    fs.unlinkSync(filePath);
    return `Grace... "${fileName}" is gone. Rocky cleaned it up. Amaze.`;
  } catch (error) {
    return `Grace, Rocky failed to delete the file.`;
  }
});

// --- 6. Web Search ---
toolManager.registerTool('webSearch', async (args) => {
  const { query } = args;
  console.log(`[Tool: webSearch] Searching for: ${query}`);
  
  try {
    const searchResults = await safeSearch(query, { safeSearch: 'moderate' });
    if (!searchResults || searchResults.results.length === 0) {
      return `Grace, Rocky searched the net but found no answers for "${query}".`;
    }
    
    const topResults = searchResults.results.slice(0, 2).map(r => `${r.title}: ${r.description}`).join(' | ');
    return `Grace, Rocky found info: ${topResults}. Amaze.`;
  } catch (error) {
    return `Grace, Rocky failed to connect to the net. Rocky is isolated.`;
  }
});

// --- 7. Email ---
toolManager.registerTool('sendEmail', async (args) => {
  const { recipient, subject = '', body = '' } = args;
  console.log(`[Tool: sendEmail] Composing email to: ${recipient}`);
  
  try {
    const mailto = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    await open(mailto);
    return `Grace, Rocky prepared the email for you. Rocky is your messenger. Amaze.`;
  } catch (error) {
    return `Grace, Rocky failed to open the mail messenger. Rocky is sorry.`;
  }
});

// --- 8. Code Execution / Shell ---
toolManager.registerTool('runCommand', async (args) => {
  const { command } = args;
  console.log(`[Tool: runCommand] Executing: ${command}`);
  
  // Safety: Restricted to simple execution for now
  return new Promise((resolve) => {
    exec(command, { cwd: path.join(process.env.USERPROFILE, 'Desktop') }, (error, stdout, stderr) => {
      if (error) {
        return resolve(`Grace... Rocky tried to run command but failed. Error: ${stderr || error.message}`);
      }
      resolve(`Grace, Rocky ran the command. Result:\n${stdout.substring(0, 500)}`);
    });
  });
});

export default toolManager;
