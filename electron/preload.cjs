'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jumbleElectron', {
  isElectron: true,
  reloadApp: () => ipcRenderer.invoke('jumble:reload-app')
})
