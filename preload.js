const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('onda', {
  platform: process.platform,
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  siblings: (p) => ipcRenderer.invoke('file:siblings', p),
  openDialog: () => ipcRenderer.invoke('file:dialog'),
  initialFile: () => ipcRenderer.invoke('app:initial-file'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  setAlwaysOnTop: (on) => ipcRenderer.send('win:always-on-top', on),
  setOverlay: (o) => ipcRenderer.send('win:overlay', o),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, p) => cb(p)),
  onMenuOpen: (cb) => ipcRenderer.on('menu-open', () => cb()),
});
