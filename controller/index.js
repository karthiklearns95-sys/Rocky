import stateManager from './stateManager.js';
import eventBus from './eventBus.js';
import brain from '../brain/index.js'; // Importing initializes the brain
import voiceController from '../voice/index.js'; // Initializes voice listeners
import { ipcMain } from 'electron';

export function initController(mainWindow) {
  console.log('[Controller] Initializing...');

  // When state changes internally, send to UI
  eventBus.on('STATE_CHANGE', (newState) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('state-changed', newState);
    }
  });

  // Handle IPC from UI (e.g., UI telling main process to start listening or a test ping)
  ipcMain.on('request-state-change', (event, newState) => {
    stateManager.setState(newState);
  });

  ipcMain.on('user-input', (event, text) => {
    stateManager.setState('listening'); // Example transition before brain
    eventBus.emit('USER_INPUT', text);
  });

  // When brain is done, update state and send response to UI
  eventBus.on('RESPONSE_READY', (response) => {
    stateManager.setState('speaking');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-response', response);
    }
    
    // Simulate speaking duration then return to idle
    setTimeout(() => {
      stateManager.setState('idle');
    }, 3000);
  });
}
