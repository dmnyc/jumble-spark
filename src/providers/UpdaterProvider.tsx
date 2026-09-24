import { getElectronBridge, isElectron } from '@/lib/platform'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { TUpdateState } from '../../electron/shared/ipc-types'

const APP_VERSION = (import.meta.env.APP_VERSION as string | undefined) ?? ''

const DEFAULT_STATE: TUpdateState = {
  status: 'idle',
  currentVersion: APP_VERSION,
  supported: false,
  autoUpdateEnabled: true
}

type TUpdaterContext = {
  state: TUpdateState
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  setAutoUpdate: (enabled: boolean) => Promise<void>
}

const UpdaterContext = createContext<TUpdaterContext | undefined>(undefined)

export function UpdaterProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [state, setState] = useState<TUpdateState>(DEFAULT_STATE)
  const previousStatusRef = useRef(state.status)

  useEffect(() => {
    if (!isElectron()) return
    const bridge = getElectronBridge()
    if (!bridge) return

    let mounted = true
    bridge.update.getState().then((s) => {
      if (mounted) setState(s)
    })
    const off = bridge.update.onState((s) => {
      if (mounted) setState(s)
    })
    return () => {
      mounted = false
      off()
    }
  }, [])

  useEffect(() => {
    const previousStatus = previousStatusRef.current
    previousStatusRef.current = state.status
    if (state.status !== 'download-error' || previousStatus === 'download-error') return

    toast.error(t('Try again later or check your connection'), {
      description: state.error
    })
  }, [state.status, state.error, t])

  const check = useCallback(async () => {
    const bridge = getElectronBridge()
    if (!bridge) return
    const s = await bridge.update.check()
    setState(s)
  }, [])

  const download = useCallback(async () => {
    const bridge = getElectronBridge()
    if (!bridge) return
    await bridge.update.download()
  }, [])

  const install = useCallback(async () => {
    const bridge = getElectronBridge()
    if (!bridge) return
    await bridge.update.install()
  }, [])

  const setAutoUpdate = useCallback(async (enabled: boolean) => {
    const bridge = getElectronBridge()
    if (!bridge) return
    const s = await bridge.update.setAutoUpdate(enabled)
    setState(s)
  }, [])

  return (
    <UpdaterContext.Provider value={{ state, check, download, install, setAutoUpdate }}>
      {children}
    </UpdaterContext.Provider>
  )
}

export function useUpdater(): TUpdaterContext {
  const ctx = useContext(UpdaterContext)
  if (!ctx) {
    throw new Error('useUpdater must be used within UpdaterProvider')
  }
  return ctx
}
