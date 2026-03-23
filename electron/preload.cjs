'use strict'

const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('jumbleElectron', {
  isElectron: true
})
