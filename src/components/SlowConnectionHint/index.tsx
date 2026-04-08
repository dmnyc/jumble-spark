import { Button } from '@/components/ui/button'
import { MEDIA_AUTO_LOAD_POLICY } from '@/constants'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { WifiOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SLOW_DISMISSED_KEY = 'slowConnectionHintDismissed'

function detectConnectionStatus(): { poor: boolean; offline: boolean } {
  const offline = !navigator.onLine
  const conn = (navigator as any).connection
  if (!conn) return { poor: offline, offline }
  if (conn.saveData === true) return { poor: true, offline }
  if (conn.type === 'none') return { poor: true, offline: true }
  const eff: string | undefined = conn.effectiveType
  return { poor: offline || eff === 'slow-2g' || eff === '2g', offline }
}

export default function SlowConnectionHint() {
  const { t } = useTranslation()
  const { autoplay, setAutoplay, mediaAutoLoadPolicy, setMediaAutoLoadPolicy } = useContentPolicy()
  const [status, setStatus] = useState(detectConnectionStatus)
  const [slowDismissed, setSlowDismissed] = useState(
    () => sessionStorage.getItem(SLOW_DISMISSED_KEY) === 'true'
  )

  useEffect(() => {
    const refresh = () => setStatus(detectConnectionStatus())
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    const conn = (navigator as any).connection
    conn?.addEventListener('change', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
      conn?.removeEventListener('change', refresh)
    }
  }, [])

  // Reset slow-connection dismissal when coming back online so the hint can
  // re-appear on the next slow-connection episode.
  useEffect(() => {
    if (!status.offline && !status.poor) {
      sessionStorage.removeItem(SLOW_DISMISSED_KEY)
      setSlowDismissed(false)
    }
  }, [status.offline, status.poor])

  if (status.offline) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="shrink-0 border-b border-border bg-muted/60 px-4 py-2.5"
      >
        <div className="flex min-w-0 items-center gap-2.5 text-muted-foreground">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium text-foreground">{t('Offline mode')}</span>
            {' — '}
            {t('Only local relays and cached content are available.')}
          </div>
        </div>
      </div>
    )
  }

  const hasExpensiveSettings =
    autoplay || mediaAutoLoadPolicy === MEDIA_AUTO_LOAD_POLICY.ALWAYS

  if (!status.poor || !hasExpensiveSettings || slowDismissed) return null

  const handleSaveData = () => {
    if (autoplay) setAutoplay(false)
    if (mediaAutoLoadPolicy !== MEDIA_AUTO_LOAD_POLICY.NEVER) {
      setMediaAutoLoadPolicy(MEDIA_AUTO_LOAD_POLICY.NEVER)
    }
    dismissSlow()
  }

  const dismissSlow = () => {
    setSlowDismissed(true)
    sessionStorage.setItem(SLOW_DISMISSED_KEY, 'true')
  }

  const changesDescription = [
    autoplay ? t('video autoplay off') : '',
    mediaAutoLoadPolicy !== MEDIA_AUTO_LOAD_POLICY.NEVER ? t('media loading off') : ''
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div
      role="alert"
      className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <WifiOff className="size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {t('Slow connection detected')}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-300">
              {changesDescription
                ? t('Turn on low-bandwidth mode? This will set: {{changes}}.', {
                    changes: changesDescription
                  })
                : t('Turn on low-bandwidth mode to reduce data usage.')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveData}
            className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600"
          >
            {t('Save data')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={dismissSlow}
            aria-label={t('Dismiss')}
            className="size-8 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
