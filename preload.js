const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('wavecast', {
  platform: process.platform,
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  siblings: (p) => ipcRenderer.invoke('file:siblings', p),
  openDialog: (multi) => ipcRenderer.invoke('file:dialog', !!multi),
  expand: (paths) => ipcRenderer.invoke('file:expand', paths),
  openFolder: () => ipcRenderer.invoke('file:folder'),
  initialFile: () => ipcRenderer.invoke('app:initial-file'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  setAlwaysOnTop: (on) => ipcRenderer.send('win:always-on-top', on),
  setFullscreen: (on) => ipcRenderer.send('win:fullscreen', on),
  setOverlay: (o) => ipcRenderer.send('win:overlay', o),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, p) => cb(p)),
  onMenuOpen: (cb) => ipcRenderer.on('menu-open', () => cb()),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen-changed', (_e, on) => cb(on)),
});
