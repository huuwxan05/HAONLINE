const { app, BrowserWindow, Menu, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_URL = 'https://haonline.example.com';
const BASE_URL = (() => {
  try {
    const parsed = new URL(process.env.HAONLINE_BASE_URL || DEFAULT_URL);
    if (!['http:', 'https:'].includes(parsed.protocol)) return DEFAULT_URL;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_URL;
  }
})();
const APP_ORIGIN = new URL(BASE_URL).origin;
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;

function isAllowed(url) {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function openExternal(url) {
  try {
    const protocol = new URL(url).protocol;
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(protocol)) shell.openExternal(url);
  } catch {
    /* ignore invalid URLs */
  }
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    if (Number.isFinite(state.width) && Number.isFinite(state.height)) return state;
  } catch {
    /* first run */
  }
  return { width: 1440, height: 900 };
}

function saveState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(STATE_FILE(), JSON.stringify({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: mainWindow.isMaximized(),
    }));
  } catch {
    /* state is best effort */
  }
}

function buildMenu() {
  const template = [
    {
      label: 'HAONLINE',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Điều hướng',
      submenu: [
        { label: 'Quay lại', accelerator: 'Alt+Left', click: () => mainWindow?.webContents.navigationHistory?.goBack() },
        { label: 'Tiến tới', accelerator: 'Alt+Right', click: () => mainWindow?.webContents.navigationHistory?.goForward() },
        { label: 'Tải lại', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
      ],
    },
    {
      label: 'Hiển thị',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Chỉnh sửa',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function configureSession() {
  const persistent = session.fromPartition('persist:haonline');
  const allowed = new Set([
    'media',
    'notifications',
    'clipboard-sanitized-write',
    'fullscreen',
    'pointerLock',
  ]);
  persistent.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(allowed.has(permission) && isAllowed(details.requestingUrl || ''));
  });
  persistent.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return allowed.has(permission) && requestingOrigin === APP_ORIGIN;
  });
}

function createWindow() {
  const state = loadState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#060814',
    title: 'HAONLINE',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:haonline',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      devTools: !app.isPackaged,
    },
  });

  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', saveState);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow,
          modal: false,
          width: 1100,
          height: 760,
          backgroundColor: '#060814',
          autoHideMenuBar: true,
          webPreferences: {
            partition: 'persist:haonline',
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowed(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _description, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (validatedUrl.startsWith('file:')) return;
    mainWindow.loadFile(path.join(__dirname, 'offline.html'), { query: { url: BASE_URL } });
  });

  mainWindow.loadURL(BASE_URL);
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  configureSession();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
