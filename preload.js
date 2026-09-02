const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({
  getPathForFile(file) {
    return webUtils?.getPathForFile?.(file) || file?.path || '';
  },
  getBackendToken() {
    return ipcRenderer.invoke('backend-api-token');
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
