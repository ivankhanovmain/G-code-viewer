const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kontur', {
  openPrograms: (multiple) => ipcRenderer.invoke('program:open', multiple === true),
  saveProgram: ({ name, fileId, bytes, occupiedIds }) =>
    ipcRenderer.invoke('program:save', { name, fileId, bytes, occupiedIds }),
})
