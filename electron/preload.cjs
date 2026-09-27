const { contextBridge, ipcRenderer } = require('electron');

const validKinds = new Set(['char', 'back', 'enter', 'space']);

contextBridge.exposeInMainWorld('keysongDesktop', {
  isDesktop: true,
  getState: () => ipcRenderer.invoke('keysong:get-state'),
  setEnabled: (enabled) => ipcRenderer.invoke('keysong:set-enabled', Boolean(enabled)),
  getMusicResource: () => ipcRenderer.invoke('keysong:get-music-resource'),
  openMusicResource: () => ipcRenderer.invoke('keysong:open-music-resource'),
  onKey: (callback) => {
    const listener = (_event, payload) => {
      if (payload && validKinds.has(payload.kind)) callback({ kind: payload.kind });
    };
    ipcRenderer.on('keysong:key', listener);
    return () => ipcRenderer.removeListener('keysong:key', listener);
  },
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('keysong:monitoring-state', listener);
    return () => ipcRenderer.removeListener('keysong:monitoring-state', listener);
  },
  onMusicResourceChange: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('keysong:music-resource-change', listener);
    return () => ipcRenderer.removeListener('keysong:music-resource-change', listener);
  },
});
