import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    listeners,
    autoUpdater: {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowPrerelease: false,
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener)
      }),
      checkForUpdates: vi.fn(async () => undefined),
      downloadUpdate: vi.fn(async () => undefined),
      quitAndInstall: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0',
    getPath: () => '/tmp/jumble-updater-tests'
  },
  BrowserWindow: class {},
  Notification: class {
    static isSupported() {
      return false
    }
  }
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mocks.autoUpdater }
}))

import { Updater } from '../../electron/main/updater'

describe('Updater download failures', () => {
  beforeEach(() => {
    mocks.listeners.clear()
    vi.clearAllMocks()
    mocks.autoUpdater.downloadUpdate.mockResolvedValue(undefined)
  })

  it('keeps the failed download visible with its last progress', () => {
    const updater = new Updater(true)

    mocks.listeners.get('update-available')?.({ version: '1.1.0' })
    expect(updater.getState()).toMatchObject({
      status: 'downloading',
      newVersion: '1.1.0',
      progressPercent: 0
    })

    mocks.listeners.get('download-progress')?.({ percent: 42.4, bytesPerSecond: 1024 })
    mocks.listeners.get('error')?.(new Error('connection dropped'))

    expect(updater.getState()).toMatchObject({
      status: 'download-error',
      newVersion: '1.1.0',
      progressPercent: 42,
      error: 'connection dropped'
    })
  })

  it('allows retrying a failed download and resets stale progress', async () => {
    const updater = new Updater(true)
    mocks.listeners.get('update-available')?.({ version: '1.1.0' })
    mocks.listeners.get('download-progress')?.({ percent: 42.4, bytesPerSecond: 1024 })
    mocks.listeners.get('error')?.(new Error('connection dropped'))
    mocks.autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('still offline'))

    await updater.download()

    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledOnce()
    expect(updater.getState()).toMatchObject({
      status: 'download-error',
      newVersion: '1.1.0',
      progressPercent: 0,
      error: 'still offline'
    })
  })

  it('keeps update-check errors separate from download errors', () => {
    const updater = new Updater(true)
    mocks.listeners.get('checking-for-update')?.()
    mocks.listeners.get('error')?.(new Error('server unavailable'))

    expect(updater.getState()).toMatchObject({
      status: 'error',
      error: 'server unavailable'
    })
  })

  it('does not let a background check replace an active download state', async () => {
    const updater = new Updater(true)
    mocks.listeners.get('update-available')?.({ version: '1.1.0' })
    mocks.listeners.get('download-progress')?.({ percent: 42.4, bytesPerSecond: 1024 })

    await updater.check()

    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.getState()).toMatchObject({
      status: 'downloading',
      progressPercent: 42
    })

    mocks.listeners.get('error')?.(new Error('connection dropped'))
    expect(updater.getState()).toMatchObject({
      status: 'download-error',
      progressPercent: 42,
      error: 'connection dropped'
    })
  })
})
