const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Create a transparent, frameless, floating window
  mainWindow = new BrowserWindow({
    width: 250,
    height: 350,
    x: width - 270, // Positioned at bottom right
    y: height - 370,
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
  import('../controller/index.js').then(({ initController }) => {
    initController(mainWindow);
  }).catch(err => console.error("Failed to load controller", err));
}

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

// IPC Example for Controller communication
ipcMain.on('ping', (event, arg) => {
  console.log('ping from renderer', arg);
  event.reply('pong', 'pong from main process');
});
