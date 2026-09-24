import type { TElectronBridge } from '../../electron/shared/ipc-types'
import { i18nReady } from '@/i18n'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { getElectronBridge } from './platform'

/**
 * Boot gate for Electron installs where safeStorage is unavailable (no OS
 * keychain, e.g. minimal Linux desktops). The on-disk stores are encrypted
 * with a password-derived key in that case, so the user must unlock (or
 * create a password on first run) before any storage is touched. After a
 * successful unlock the page reloads and the normal bootstrap proceeds.
 *
 * Returns true when the app should stop booting because a reload is pending.
 */
export async function ensureElectronStorageUnlocked(): Promise<boolean> {
  const bridge = getElectronBridge()
  if (!bridge) return false

  let status
  try {
    status = await bridge.security.getStatus()
  } catch (error) {
    console.error('[unlock] failed to query security status:', error)
    return false
  }
  if (status.backend !== 'password' || status.unlocked) return false

  await i18nReady
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await new Promise<void>((resolve) => {
    root.render(
      <UnlockScreen
        needsSetup={status.needsSetup}
        bridge={bridge}
        onDone={() => {
          root.unmount()
          container.remove()
          resolve()
        }}
      />
    )
  })
  window.location.reload()
  return true
}

function useIsDark(): boolean {
  const [isDark] = useState(() => {
    const themeSetting = window.localStorage.getItem('themeSetting')
    if (themeSetting === 'dark') return true
    if (themeSetting === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  return isDark
}

function UnlockScreen({
  needsSetup,
  bridge,
  onDone
}: {
  needsSetup: boolean
  bridge: TElectronBridge
  onDone: () => void
}) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)

    if (needsSetup) {
      if (password.length < 4) {
        setError(t('Password must be at least 4 characters'))
        return
      }
      if (password !== confirm) {
        setError(t('Passwords do not match'))
        return
      }
      setBusy(true)
      try {
        await bridge.security.setupPassword(password)
        onDone()
      } catch (err) {
        console.error('[unlock] failed to set password:', err)
        setBusy(false)
      }
      return
    }

    setBusy(true)
    try {
      const ok = await bridge.security.unlock(password)
      if (ok) {
        onDone()
      } else {
        setError(t('Incorrect password'))
        setBusy(false)
      }
    } catch (err) {
      console.error('[unlock] failed to unlock:', err)
      setBusy(false)
    }
  }

  const reset = async () => {
    if (busy) return
    setBusy(true)
    try {
      await bridge.security.reset()
      onDone()
    } catch (err) {
      console.error('[unlock] failed to reset:', err)
      setBusy(false)
    }
  }

  const colors = isDark ? 'bg-[#171717] text-neutral-100' : 'bg-neutral-50 text-neutral-900'
  const cardColors = isDark ? 'bg-neutral-900 border-neutral-700' : 'bg-white border-neutral-200'
  const inputColors = isDark
    ? 'bg-neutral-800 border-neutral-600 text-neutral-100'
    : 'bg-white border-neutral-300 text-neutral-900'
  const mutedColors = isDark ? 'text-neutral-400' : 'text-neutral-500'

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${colors}`}>
      <div className={`w-80 rounded-xl border p-6 shadow-lg ${cardColors}`}>
        {confirmingReset ? (
          <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold">{t('Reset encrypted data')}</h1>
            <p className={`text-sm ${mutedColors}`}>{t('Reset encrypted data warning')}</p>
            <button
              type="button"
              disabled={busy}
              onClick={reset}
              className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {t('Reset encrypted data')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingReset(false)}
              className={`w-full rounded-lg px-4 py-2 text-sm ${mutedColors} hover:underline`}
            >
              {t('Cancel')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <h1 className="text-lg font-semibold">
                {needsSetup ? t('Create password') : t('Unlock Jumble')}
              </h1>
              <p className={`mt-1 text-sm ${mutedColors}`}>
                {needsSetup ? t('Password storage explanation') : t('No system keychain available')}
              </p>
            </div>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('Password')}
              className={`focus:ring-primary w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${inputColors}`}
            />
            {needsSetup && (
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t('Confirm password')}
                className={`focus:ring-primary w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${inputColors}`}
              />
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={busy || password.length === 0}
              className="bg-primary text-primary-foreground w-full rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {needsSetup ? t('Create password') : t('Unlock')}
            </button>
            {!needsSetup && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingReset(true)}
                className={`text-sm ${mutedColors} hover:underline`}
              >
                {t('Forgot password?')}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
