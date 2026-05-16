const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Create a transparent, frameless, floating window
  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Start with mouse events enabled so user can interact
  // The renderer will toggle this dynamically based on mouse position
  mainWindow.setIgnoreMouseEvents(false);

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
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' }); // Opens the console automatically
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
