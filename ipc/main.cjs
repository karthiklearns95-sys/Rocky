const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// SwiftShader software WebGL fallback
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

let mainWindow;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Create a transparent, frameless, floating window
  const ROCKY_W = 340;
  const ROCKY_H = 440;
  mainWindow = new BrowserWindow({
    width: ROCKY_W,
    height: ROCKY_H,
    x: width - ROCKY_W - 30,
    y: height - ROCKY_H - 60,
    transparent: false,
    frame: false,
    hasShadow: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#08080c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // IMPORTANT: Start with ignore=true so keyboard + mouse passes through to apps underneath.
  // Rocky's onMouseEnter/Leave in Rocky.jsx toggles this dynamically via IPC.
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // In development, load the Vite dev server. Otherwise, load built index.html.
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true); // Approve microphone access
    } else {
      callback(false);
    }
  });

  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    // Use VITE_PORT env var so Electron follows Vite if port 5173 is in use
    const vitePort = process.env.VITE_PORT || 5173;
    mainWindow.loadURL(`http://localhost:${vitePort}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Handle window drag globally if needed, though usually handled via CSS app-region
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Initialize Controller
  import('#services/index.js').then(({ initController }) => {
    initController(mainWindow);
  }).catch(err => console.error("Failed to load controller", err));

  // Aura HUD Telemetry relay
  process.on('aura_telemetry', (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('aura-telemetry', payload);
    }
  });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC for dynamic mouse event toggling from renderer
ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// IPC for dragging Rocky to a new position
ipcMain.on('drag-window', (event, { x, y }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({ x: bounds.x + x, y: bounds.y + y, width: bounds.width, height: bounds.height });
  }
});

// IPC for streaming audio chunks from frontend VAD
ipcMain.on('audio-buffer', (event, buffer) => {
  if (buffer) {
    console.log(`[IPC] Received audio buffer: ${buffer.byteLength} bytes`);
    const float32Array = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
    import('#services/eventBus.js').then(({ default: eventBus }) => {
      eventBus.emit('AUDIO_BUFFER', float32Array);
    }).catch(err => console.error("EventBus import error", err));
  }
});

ipcMain.on('log', (event, msg) => {
  console.log('[UI Log]', msg);
});
