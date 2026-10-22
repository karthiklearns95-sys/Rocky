import voiceController from '#voice/voiceController.js';
import stateManager from '#services/stateManager.js';
import eventBus from '#services/eventBus.js';
import brain from '#brain/index.js'; // Importing initializes the brain
import { ipcMain, screen } from 'electron';
import { planOverlayMove, refitBounds, applyBounds } from '../ipc/overlayPlacement.js';

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
    // Typing in Rocky's box gives Rocky's window the focus. Hand it back to the app Grace was using,
    // so "click File" acts on that app and not on Rocky's own window.
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) mainWindow.blur();
    eventBus.emit('USER_INPUT', text);
  });

  // When brain is done, update state and send final full response to UI
  eventBus.on('RESPONSE_READY', (response) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-response', response);
    }
  });

  // Relay streaming tokens to UI for real-time TTS
  eventBus.on('TOKEN_GENERATED', (token) => {
    stateManager.setState('speaking');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-token', token);
    }
  });

  // Handle movement commands from the Brain
  eventBus.on('MOVE_AGENT', (positionCommand) => {
    stateManager.setState('moving');
    if (mainWindow && !mainWindow.isDestroyed()) {
      // On several monitors the overlay may have to hop to another one first; the renderer then gets
      // a position inside the window (flagged `local`) instead of a desktop coordinate.
      let plan = { bounds: null, command: positionCommand };
      try { plan = planOverlayMove(screen, mainWindow.getBounds(), positionCommand); }
      catch (err) { console.warn('[Controller] Could not place Rocky on a monitor:', err.message); }
      applyBounds(mainWindow, plan.bounds);
      if (plan.command != null) mainWindow.webContents.send('agent-move', plan.command);
    }
  });

  // Monitors plugged, unplugged or resized: keep the overlay on screen and sized to its monitor.
  const refit = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try { applyBounds(mainWindow, refitBounds(screen, mainWindow.getBounds())); }
    catch (err) { console.warn('[Controller] Could not refit the overlay:', err.message); }
  };
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, refit);

  // Rocky's mood drives the avatar's posture and glow
  eventBus.on('MOOD_CHANGE', (mood) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mood-changed', mood);
    }
  });

  // Voice health (microphone / speech model) for the UI. The first status is emitted before the window
  // has loaded, so remember the latest one and let the renderer ask for it when it mounts.
  let lastVoiceStatus = null;
  eventBus.on('VOICE_STATUS', (status) => {
    lastVoiceStatus = status;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('voice-status', status);
    }
  });
  ipcMain.handle('get-voice-status', () => lastVoiceStatus);

  // Relay mail events to UI
  eventBus.on('MAIL_SENT', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mail-sent', data);
    }
  });

  ipcMain.on('speech-ended', () => {
    stateManager.setState('idle');
  });

  // Start the offline Windows STT AFTER all listeners are ready
  voiceController.start();
}

export default voiceController;
