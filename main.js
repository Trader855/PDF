const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let pyProc = null;
let mainWindow = null;
let updaterConfigured = false;
let updateCheckActive = false;
let activeCheckIsManual = false;
let updateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function startBackend() {
  const logPath = path.join(app.getPath('logs'), 'backend.log');
  const backendLog = fs.createWriteStream(logPath, { flags: 'a' });
  backendLog.write(`\n--- Avvio backend ${new Date().toISOString()} ---\n`);

  const backendExecutable = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'mac-pdf-backend')
    : '/usr/bin/arch';
  const backendArguments = app.isPackaged
    ? []
    : ['-arm64', '/usr/bin/python3', path.join(__dirname, 'backend', 'main.py')];
  const backendDirectory = app.isPackaged
    ? path.dirname(backendExecutable)
    : __dirname;
  const fontsDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'fonts')
    : path.join(__dirname, 'assets', 'fonts');

  pyProc = spawn(backendExecutable, backendArguments, {
    cwd: backendDirectory,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      MAC_PDF_EDITOR_FONTS_DIR: fontsDirectory,
    },
  });

  pyProc.stdout.on('data', (data) => {
    backendLog.write(data);
    console.log(`[backend] ${data}`);
  });
  pyProc.stderr.on('data', (data) => {
    backendLog.write(data);
    console.error(`[backend] ${data}`);
  });
  pyProc.on('error', (error) => {
    backendLog.write(`Impossibile avviare il backend: ${error.stack || error}\n`);
    console.error('Impossibile avviare il backend:', error);
  });
  pyProc.on('exit', (code, signal) => {
    backendLog.write(`Backend terminato (code=${code}, signal=${signal})\n`);
    backendLog.end();
    console.log(`Backend terminato (code=${code}, signal=${signal})`);
    pyProc = null;
  });
}

function stopBackend() {
  if (pyProc) pyProc.kill();
}

function normaliseReleaseNotes(releaseNotes) {
  if (typeof releaseNotes === 'string') return releaseNotes.trim();
  if (!Array.isArray(releaseNotes)) return '';
  return releaseNotes
    .map((entry) => typeof entry === 'string' ? entry : entry?.note)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function safeUpdaterMessage(error) {
  const message = error?.message || String(error || 'Errore sconosciuto');
  return message
    .replace(/https?:\/\/[^\s]+/gi, 'server degli aggiornamenti')
    .replace(/token=[^\s&]+/gi, 'token=***')
    .slice(0, 500);
}

function sendUpdateState(nextState = {}) {
  updateState = {
    ...updateState,
    ...nextState,
    currentVersion: app.getVersion(),
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', updateState);
  }
  return updateState;
}

function configureUpdater() {
  if (updaterConfigured) return;
  updaterConfigured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateState({ phase: 'checking', manual: activeCheckIsManual, error: '' });
  });
  autoUpdater.on('update-available', (info) => {
    updateCheckActive = false;
    sendUpdateState({
      phase: 'available',
      manual: activeCheckIsManual,
      latestVersion: info.version,
      releaseName: info.releaseName || '',
      releaseNotes: normaliseReleaseNotes(info.releaseNotes),
      error: '',
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    updateCheckActive = false;
    sendUpdateState({
      phase: 'up-to-date',
      manual: activeCheckIsManual,
      latestVersion: info?.version || app.getVersion(),
      error: '',
    });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateState({
      phase: 'downloading',
      manual: true,
      percent: Math.max(0, Math.min(100, progress.percent || 0)),
      transferred: progress.transferred || 0,
      total: progress.total || 0,
      bytesPerSecond: progress.bytesPerSecond || 0,
      error: '',
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateState({
      phase: 'downloaded',
      manual: true,
      latestVersion: info.version,
      percent: 100,
      releaseNotes: normaliseReleaseNotes(info.releaseNotes) || updateState.releaseNotes || '',
      error: '',
    });
  });
  autoUpdater.on('error', (error) => {
    updateCheckActive = false;
    sendUpdateState({
      phase: 'error',
      manual: activeCheckIsManual || ['downloading', 'downloaded'].includes(updateState.phase),
      error: safeUpdaterMessage(error),
    });
  });
}

async function checkForAppUpdate(manual = false) {
  if (!app.isPackaged) {
    return sendUpdateState({
      phase: 'development',
      manual,
      error: '',
    });
  }

  configureUpdater();
  if (updateCheckActive) {
    return sendUpdateState({ ...updateState, manual: Boolean(manual || updateState.manual) });
  }

  activeCheckIsManual = Boolean(manual);
  updateCheckActive = true;
  sendUpdateState({ phase: 'checking', manual: activeCheckIsManual, error: '' });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    updateCheckActive = false;
    sendUpdateState({
      phase: 'error',
      manual: activeCheckIsManual,
      error: safeUpdaterMessage(error),
    });
  }
  return updateState;
}

function configureApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit' }],
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'Vista',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Finestra',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Controlla aggiornamenti…',
          click: () => {
            if (mainWindow?.isMinimized()) mainWindow.restore();
            mainWindow?.show();
            mainWindow?.focus();
            checkForAppUpdate(true).catch((error) => console.error('Controllo aggiornamenti:', error));
          },
        },
        { type: 'separator' },
        { label: `Versione ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.once('did-finish-load', () => {
    sendUpdateState();
    setTimeout(() => {
      checkForAppUpdate(false).catch((error) => console.error('Controllo aggiornamenti:', error));
    }, 4000);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  configureApplicationMenu();
  startBackend();
  createWindow();
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

ipcMain.handle('save-pdf-as', async (_event, defaultName) => {
  const result = await dialog.showSaveDialog({
    title: 'Salva una nuova versione del PDF',
    defaultPath: defaultName,
    filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('get-update-status', () => updateState);

ipcMain.handle('check-for-updates', (_event, options = {}) => {
  return checkForAppUpdate(Boolean(options.manual));
});

ipcMain.handle('download-update', async () => {
  if (!app.isPackaged) return checkForAppUpdate(true);
  if (updateState.phase !== 'available') return updateState;
  sendUpdateState({ phase: 'downloading', manual: true, percent: 0, error: '' });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    sendUpdateState({ phase: 'error', manual: true, error: safeUpdaterMessage(error) });
  }
  return updateState;
});

ipcMain.handle('install-update', () => {
  if (!app.isPackaged || updateState.phase !== 'downloaded') return false;
  stopBackend();
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
});

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  stopBackend();
});
