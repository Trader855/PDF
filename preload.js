const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({
  getPathForFile(file) {
    const filePath = webUtils.getPathForFile(file);
    if (!filePath) throw new Error('Seleziona un file PDF dal computer');
    return ipcRenderer.invoke('register-local-file', filePath);
  },
  request(endpoint, body) {
    return ipcRenderer.invoke('backend-request', endpoint, body);
  },
  pruneSession(keepPaths) {
    return ipcRenderer.invoke('prune-session', keepPaths);
  },
  openExternal(externalUrl) {
    return ipcRenderer.invoke('open-external-url', externalUrl);
  },
  readFile(filePath) {
    return ipcRenderer.invoke('read-local-file', filePath);
  },
  copyFile(sourcePath, destinationPath) {
    return ipcRenderer.invoke('copy-local-file', sourcePath, destinationPath);
  },
  savePdfAs(defaultName) {
    return ipcRenderer.invoke('save-pdf-as', defaultName);
  },
  getUpdateStatus() {
    return ipcRenderer.invoke('get-update-status');
  },
  checkForUpdates(options) {
    return ipcRenderer.invoke('check-for-updates', options);
  },
  downloadUpdate() {
    return ipcRenderer.invoke('download-update');
  },
  installUpdate() {
    return ipcRenderer.invoke('install-update');
  },
  onUpdateStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
}));
