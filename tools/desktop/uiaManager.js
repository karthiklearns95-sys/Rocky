import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import net from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * uiaManager.js
 * 
 * Re-architected Persistent IPC Bridge. 
 * Eliminates all PowerShell child_process forking.
 */
class UIAManager {
  constructor() {
    this.sourcePath = path.join(__dirname, '../../automation/uiaDaemon.cs');
    this.exePath = path.join(__dirname, '../../automation/uiaDaemon.exe');
    this.pipeName = '\\\\.\\pipe\\UIA_ROCKY_PIPE';
    this.client = null;
    this.daemonProcess = null;
    this.pendingRequests = [];
    this.connected = false;
    
    this._ensureDaemon();
  }

  _ensureDaemon() {
    // Compile the C# daemon if it doesn't exist or is outdated
    if (!fs.existsSync(this.exePath) || fs.statSync(this.sourcePath).mtimeMs > fs.statSync(this.exePath).mtimeMs) {
      console.log('[UIAManager] Compiling native C# UIA Daemon...');
      try {
        const psCmd = `Add-Type -TypeDefinition (Get-Content '${this.sourcePath}' -Raw) -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, System.Text.RegularExpressions -OutputAssembly '${this.exePath}' -OutputType ConsoleApplication`;
        execSync(`powershell -NoProfile -Command "${psCmd}"`);
        console.log('[UIAManager] Compilation successful.');
      } catch (e) {
        console.error('[UIAManager] Failed to compile daemon:', e.message);
      }
    }

    // Spawn the persistent daemon background process
    this.daemonProcess = spawn(this.exePath, [], { detached: true, stdio: 'ignore' });
    this.daemonProcess.unref();
    
    this._connectToPipe();
  }

  _connectToPipe() {
    let retries = 0;
    const attempt = () => {
      this.client = net.createConnection(this.pipeName, () => {
        console.log('[UIAManager] IPC Bridge Connected to UIA Daemon.');
        this.connected = true;
      });

      this.client.on('data', async (data) => {
        const lines = data.toString().trim().split('\n').filter(l => l.trim());
        
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                
                // OUT-OF-BAND ANOMALY (e.g. human interruption, focus stealing)
                if (parsed.type === 'anomaly') {
                    console.warn(`[UIAManager] ⚠️ OS ANOMALY DETECTED:`, parsed.event);
                    const { default: eventBus } = await import('../../services/eventBus.js');
                    eventBus.emit('execution:anomaly', parsed);
                    continue;
                }

                // Standard synchronous response
                if (this.pendingRequests.length > 0) {
                  const { resolve } = this.pendingRequests.shift();
                  if (parsed.status === 'success') {
                      resolve({ success: true, method: "ipc_native", latency: parsed.latency, elementState: parsed.elementState });
                  } else {
                      resolve({ success: false, error: parsed.code });
                  }
                }
            } catch (e) {
                if (this.pendingRequests.length > 0) {
                    const { resolve } = this.pendingRequests.shift();
                    resolve({ success: false, error: "Failed to parse IPC output", raw: line });
                }
            }
        }
      });

      this.client.on('error', (err) => {
        if (retries < 15) {
          retries++;
          setTimeout(attempt, 200); // 200ms backoff
        } else {
          console.error('[UIAManager] FATAL: IPC Connection failed after retries.');
        }
      });
      
      this.client.on('end', () => {
        this.connected = false;
      });
    };

    // Initial delay to let the C# process boot and open the pipe
    setTimeout(attempt, 300);
  }

  async runCommand(action, query = "", roleHint = "", value = "", signal = null) {
    if (!this.connected) {
      return { success: false, error: 'Daemon not connected' };
    }

    // Cleanse quotes to prevent JSON breakage
    const safeQuery = query.replace(/"/g, "'");
    const safeValue = value.replace(/"/g, "'");
    
    const payload = JSON.stringify({ action, targetName: safeQuery, roleHint, value });

    const result = await new Promise((resolve) => {
      const request = { resolve };
      
      if (signal) {
        signal.addEventListener('abort', () => {
          const index = this.pendingRequests.indexOf(request);
          if (index !== -1) {
             this.pendingRequests.splice(index, 1);
          }
          // The C# process might still execute it, but we immediately abort upstream
          resolve({ success: false, error: 'Aborted', isAbort: true });
        }, { once: true });
      }

      this.pendingRequests.push(request);
      this.client.write(payload + '\n');
    });

    // --- PERCEPTION ENGINE FALLBACK INTERCEPT ---
    if (result.success === false && result.error === 'ElementNotFound' && action !== 'hard_click') {
        console.log(`[UIAManager] ElementNotFound in native tree. Falling back to Visual Perception Engine...`);
        try {
            // Dynamic import prevents heavy Tesseract initialization on every startup
            const { perceptionEngine } = await import('../../vision/perceptionEngine.js');
            const bbox = await perceptionEngine.locateTextOnScreen(query);
            
            if (bbox) {
                const targetX = Math.floor(bbox.x + bbox.width / 2);
                const targetY = Math.floor(bbox.y + bbox.height / 2);
                console.log(`[UIAManager] Visually located at (${targetX}, ${targetY}). Firing hard click.`);
                
                // Dispatch a hard_click to the Daemon passing coords in the extra payload
                return await this.runCommand('hard_click', query, '', JSON.stringify({ x: targetX, y: targetY }), signal);
            }
        } catch (e) {
            console.warn(`[UIAManager] Vision fallback crashed:`, e.message);
        }
    }

    return result;
  }
}

export const uiaManager = new UIAManager();
