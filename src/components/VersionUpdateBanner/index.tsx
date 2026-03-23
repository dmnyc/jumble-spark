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

    let registration: ServiceWorkerRegistration | null = null

    const checkForUpdates = async () => {
      try {
        registration = await navigator.serviceWorker.ready
        if (!registration) return

        // Check if there's a waiting service worker (new version ready)
        if (registration.waiting) {
          // There's already a new version waiting
          setUpdateAvailable(true)
        }

        // Listen for updates
        const handleUpdateFound = () => {
          const newWorker = registration?.installing
          if (!newWorker) return

          const handleStateChange = () => {
            if (newWorker.state === 'installed') {
              // New version installed
              if (navigator.serviceWorker.controller) {
                // There's a new version ready (not the first install)
                setUpdateAvailable(true)
              }
            }
          }

          newWorker.addEventListener('statechange', handleStateChange)
        }

        registration.addEventListener('updatefound', handleUpdateFound)

        // Check for updates periodically
        const checkInterval = setInterval(() => {
          if (registration) {
            registration.update()
          }
        }, 60000) // Check every minute

        // Initial update check
        registration.update()

        return () => {
          clearInterval(checkInterval)
          if (registration) {
            registration.removeEventListener('updatefound', handleUpdateFound as EventListener)
          }
        }
      } catch (error) {
        // In non-secure contexts or when no SW is registered, ready can reject with "The operation is insecure"
        logger.debug('Service worker update check skipped or failed', { error })
      }
    }

    checkForUpdates().catch(() => {})
  }, [])

  const handleUpdate = () => {
    setIsUpdating(true)
    // Reload the page to activate the new service worker
    window.location.reload()
  }

  const handleDismiss = () => {
    setIsDismissed(true)
    // Store dismissal in localStorage to avoid showing it again this session
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

