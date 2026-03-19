const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taxApp', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  getDebugLogPath: () => ipcRenderer.invoke('app:get-debug-log-path'),
  pickFile: () => ipcRenderer.invoke('dialog:pick-file'),
  loadFile: (filePath) => ipcRenderer.invoke('file:load', filePath),
  prepareQueue: (columns) => ipcRenderer.invoke('queue:prepare', columns),
  start: () => ipcRenderer.invoke('process:start'),
  pause: () => ipcRenderer.invoke('process:pause'),
  resume: () => ipcRenderer.invoke('process:resume'),
  stop: () => ipcRenderer.invoke('process:stop'),
  clearResults: () => ipcRenderer.invoke('results:clear'),
  exportFile: () => ipcRenderer.invoke('file:export'),
  getProxySettings: () => ipcRenderer.invoke('proxy:get-settings'),
  saveProxySettings: (settings) => ipcRenderer.invoke('proxy:save-settings', settings),
  refreshProxyStatus: () => ipcRenderer.invoke('proxy:refresh-status'),
  onStateUpdate: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('state:update', listener);
    return () => ipcRenderer.removeListener('state:update', listener);
  },
});
