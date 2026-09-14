const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clarity', {
  requestMicrophoneAccess: () => ipcRenderer.invoke('permissions:microphone'),
  permissionsCheck: () => ipcRenderer.invoke('permissions:check'),
  openClaritySettings: () => ipcRenderer.send('permissions:open-settings'),
  openPane: (url) => ipcRenderer.send('open-pane', url),
  permissionsContinue: () => ipcRenderer.send('permissions:continue'),
  restartApp: () => ipcRenderer.send('permissions:restart-app'),
  onPermissionsRefresh: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('permissions:refresh', listener);
    return () => ipcRenderer.removeListener('permissions:refresh', listener);
  },
  quit: () => ipcRenderer.send('app:quit'),
  log: (msg) => ipcRenderer.send('log', msg),
});
