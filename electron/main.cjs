'use strict'

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('fs')
const path = require('path')

/** True when running from source (`electron .`); false when packaged. */
const isDev = !app.isPackaged

function resolveWindowIcon() {
  const candidates = isDev
    ? [path.join(__dirname, '..', 'public', 'favicon.png')]
    : [path.join(__dirname, '..', 'dist', 'favicon.png')]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  return undefined
}

function loadRenderer(win) {
  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
    void win.loadURL(devUrl)
    if (!win.webContents.isDevToolsOpened()) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
    return
  }
  void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 400,
    minHeight: 500,
    show: false,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  loadRenderer(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  ipcMain.handle('imwald:reload-app', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false
    loadRenderer(win)
    return true
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
