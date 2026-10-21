const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  importLut: () => ipcRenderer.invoke('lut:import'),
  readLut: (p) => ipcRenderer.invoke('lut:read', p),
  importMedia: () => ipcRenderer.invoke('media:import'),
  probeFiles: (files) =>
    ipcRenderer.invoke(
      'media:probe',
      files.map((f) => webUtils.getPathForFile(f)),
    ),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  openProject: () => ipcRenderer.invoke('project:open'),
  chooseExportPath: () => ipcRenderer.invoke('export:choosePath'),
  startExport: (project, outPath, settings) =>
    ipcRenderer.invoke('export:start', project, outPath, settings),
  exportDefaults: () => ipcRenderer.invoke('export:defaults'),
  chooseFolder: (current) => ipcRenderer.invoke('dialog:chooseFolder', current),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  openFile: (p) => ipcRenderer.invoke('shell:open', p),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('export:progress', listener);
    return () => ipcRenderer.removeListener('export:progress', listener);
  },
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
});
