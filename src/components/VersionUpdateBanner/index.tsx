import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import logger from '@/lib/logger'

export default function VersionUpdateBanner() {
  const { t } = useTranslation()
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    // Skip in dev: no SW is registered (vite-plugin-pwa devOptions.enabled: false), and .ready can reject with "operation is insecure"
    if (import.meta.env.DEV || typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator)) {
      return
    }

    /**
     * Workbox is built with skipWaiting + clientsClaim, so `registration.waiting` is almost never
     * set — the new worker activates immediately. The reliable signal is `controllerchange`.
     * Skip the first such event when we started without a controller (first install for this origin).
     */
    let ignoreNextControllerChange = !navigator.serviceWorker.controller
    let cancelled = false
    const cleanups: Array<() => void> = []

    const runCleanup = () => {
      for (let i = cleanups.length - 1; i >= 0; i--) {
        try {
          cleanups[i]?.()
        } catch {
          // ignore
        }
      }
      cleanups.length = 0
    }

    const onControllerChange = () => {
      if (ignoreNextControllerChange) {
        ignoreNextControllerChange = false
        return
      }
      if (navigator.serviceWorker.controller) {
        setUpdateAvailable(true)
      }
    }

    ;(async () => {
      try {
        const registration = await navigator.serviceWorker.ready
        if (cancelled || !registration) return

        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
        cleanups.push(() => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange))

        if (registration.waiting) {
          setUpdateAvailable(true)
        }

        const installingListeners: Array<{ worker: ServiceWorker; fn: () => void }> = []

        const handleUpdateFound = () => {
          const newWorker = registration.installing
          if (!newWorker) return

          const onState = () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateAvailable(true)
            }
          }
          // May already be `installed` before we attach (skipWaiting race)
          onState()
          newWorker.addEventListener('statechange', onState)
          installingListeners.push({ worker: newWorker, fn: onState })
        }

        registration.addEventListener('updatefound', handleUpdateFound)
        cleanups.push(() => registration.removeEventListener('updatefound', handleUpdateFound))
        cleanups.push(() => {
          for (const { worker, fn } of installingListeners) {
            worker.removeEventListener('statechange', fn)
          }
          installingListeners.length = 0
        })

        const checkUpdate = () => {
          if (document.hidden) return
          registration.update().catch(() => {})
        }
        const interval = window.setInterval(checkUpdate, 60_000)
        cleanups.push(() => window.clearInterval(interval))
        document.addEventListener('visibilitychange', checkUpdate)
        cleanups.push(() => document.removeEventListener('visibilitychange', checkUpdate))

        checkUpdate()
      } catch (error) {
        logger.debug('Service worker update check skipped or failed', { error })
      }
    })()

    return () => {
      cancelled = true
      runCleanup()
    }
  }, [])

  const handleUpdate = () => {
    setIsUpdating(true)
    // Reload the page to activate the new service worker
    window.location.reload()
  }

  const handleDismiss = () => {
    setIsDismissed(true)
    // Store dismissal in sessionStorage to avoid showing it again this session
    sessionStorage.setItem('versionUpdateDismissed', 'true')
  }

  // Check if user already dismissed this session
  useEffect(() => {
    const dismissed = sessionStorage.getItem('versionUpdateDismissed')
    if (dismissed === 'true') {
      setIsDismissed(true)
    }
  }, [])

  if (!updateAvailable || isDismissed) {
    return null
  }

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <RefreshCw className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              {t('A new version is available')}
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-300">
              {t('Click update to get the latest features and improvements')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            onClick={handleUpdate}
            disabled={isUpdating}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isUpdating ? (
              <>
                <Skeleton className="mr-2 size-4 shrink-0 rounded-sm" aria-hidden />
                {t('Updating...')}
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('Update')}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="h-8 w-8 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
