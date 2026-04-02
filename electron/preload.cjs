'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('imwaldElectron', {
  isElectron: true,
  reloadApp: () => ipcRenderer.invoke('imwald:reload-app')
})
