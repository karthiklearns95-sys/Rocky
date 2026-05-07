const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  ping: (message) => ipcRenderer.send('ping', message),
  onPong: (callback) => ipcRenderer.on('pong', (_event, value) => callback(value)),
  onStateChanged: (callback) => ipcRenderer.on('state-changed', (_event, value) => callback(value)),
  requestStateChange: (newState) => ipcRenderer.send('request-state-change', newState),
  sendUserInput: (text) => ipcRenderer.send('user-input', text),
  speechEnded: () => ipcRenderer.send('speech-ended'),
  onAgentResponse: (callback) => ipcRenderer.on('agent-response', (_event, value) => callback(value)),
  onAgentToken: (callback) => ipcRenderer.on('agent-token', (_event, value) => callback(value)),
  onAgentMove: (callback) => ipcRenderer.on('agent-move', (_event, value) => callback(value)),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  dragWindow: (delta) => ipcRenderer.send('drag-window', delta),
  onMailSent: (callback) => ipcRenderer.on('mail-sent', (_event, value) => callback(value)),
  
  // Future methods for execution, memory, and controller layers
  // executeCommand: (cmd) => ipcRenderer.invoke('execute-command', cmd),
});
