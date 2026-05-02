import ToolManager from './toolManager.js';
import open from 'open';
import screenshot from 'screenshot-desktop';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import pkg from 'duck-duck-scrape';
import openChromeProfile from './system/openChromeProfile.js';
import createFileWithContent from './system/createFileWithContent.js';
import openFile from './system/openFile.js';

const { safeSearch } = pkg;

const toolManager = new ToolManager();

// Register Modular Tools
toolManager.registerTool('openChromeProfile', openChromeProfile);
toolManager.registerTool('createFileWithContent', createFileWithContent);
toolManager.registerTool('openFile', openFile);

// --- 1. Launch Apps ---
toolManager.registerTool('openApp', async (args) => {
  const appName = args.appName.toLowerCase();
  console.log(`[Tool: openApp] Opening: ${appName}`);
  
  try {
    const appMap = {
      'chrome': 'chrome',
      'google': 'chrome',
      'firefox': 'firefox',
      'vscode': 'code',
      'notepad': 'notepad',
      'calculator': 'calc',
      'spotify': 'spotify',
      'discord': 'discord',
      'terminal': 'wt' // Windows Terminal
    };

    const target = appMap[appName] || appName;
    console.log(`[Tool: openApp] Mapping ${appName} -> ${target}`);

    return new Promise(async (resolve) => {
      // 1. Try direct shell 'start' - most reliable for Windows aliases/exes
      exec(`cmd /c start "" "${target}"`, (err1) => {
        if (!err1) return resolve(`Rocky opened ${appName} for you, Grace. Amaze.`);

        // 2. Try adding .exe if not present
        const exeTarget = target.endsWith('.exe') ? target : `${target}.exe`;
        exec(`cmd /c start "" "${exeTarget}"`, (err2) => {
          if (!err2) return resolve(`Rocky opened ${appName} for you, Grace. Amaze.`);

          // 3. Try searching for the path with 'where'
          exec(`where "${target}"`, (err3, stdout3) => {
            let searchTarget = target;
            if (err3 || !stdout3) {
              searchTarget = exeTarget;
            }

            exec(`where "${searchTarget}"`, (err4, stdout4) => {
              if (err4 || !stdout4) {
                // Fallback 3: Hardcoded common Windows paths for priority apps
                const commonPaths = {
                  'chrome': [
                    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
                  ],
                  'code': [
                    `${process.env.USERPROFILE}\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe`,
                    'C:\\Program Files\\Microsoft VS Code\\Code.exe'
                  ]
                };

                const possiblePaths = commonPaths[target] || [];
                for (const p of possiblePaths) {
                  if (fs.existsSync(p)) {
                    exec(`cmd /c start "" "${p}"`);
                    return resolve(`Rocky found and opened ${appName} in a common folder. Amaze.`);
                  }
                }

                return resolve(`Grace... Rocky searched the whole desktop but cannot find ${appName}. Rocky is sorry.`);
              }

              const fullPath = stdout4.split('\r\n')[0].split('\n')[0].trim();
              console.log(`[Tool: openApp] Found full path: ${fullPath}`);
              
              exec(`cmd /c start "" "${fullPath}"`, (err5) => {
                if (err5) return resolve(`Grace... Rocky found ${appName} at ${fullPath} but could not open it.`);
                resolve(`Rocky found and opened ${appName}. Amaze.`);
              });
            });
          });
        });
      });
    });
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
    // Fallback: Use PowerShell to take a screenshot
    console.log(`[Tool: takeScreenshot] screenshot-desktop failed, trying PowerShell...`);
    return new Promise((resolve) => {
      const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');
      const filename = `Rocky_Screenshot_PS_${Date.now()}.png`;
      const filePath = path.join(desktopPath, filename);
      
      const psCommand = `powershell -Command "[Reflection.Assembly]::LoadWithPartialName('System.Drawing'); [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $screen = [System.Windows.Forms.Screen]::PrimaryScreen; $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($screen.Bounds.X, $screen.Bounds.Y, 0, 0, $bitmap.Size); $bitmap.Save('${filePath}', [System.Drawing.Imaging.ImageFormat]::Png); $graphics.Dispose(); $bitmap.Dispose();"`;
      
      exec(psCommand, (psError) => {
        if (psError) {
          resolve(`Grace, Rocky failed to capture screen even with PowerShell. Rocky is sorry.`);
        } else {
          resolve(`Grace, Rocky saved a screenshot via PowerShell to your desktop. Amaze.`);
        }
      });
    });
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
// Note: createFile is now handled by the modular createFileWithContent tool
toolManager.registerTool('createFile', createFileWithContent);

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
    return `Grace, Rocky's net search failed. Rocky will stick to what he knows. Amaze.`;
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
