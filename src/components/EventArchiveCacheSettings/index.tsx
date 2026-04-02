import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { StorageKey } from '@/constants'
import {
  EVENT_ARCHIVE_DEFAULTS,
  getEventArchiveConfig
} from '@/lib/event-archive-config'
import { isImwaldElectron, isMobileBrowserProfile } from '@/lib/client-platform'
import client from '@/services/client.service'
import { invalidateArchiveFootprintCache } from '@/services/event-archive.service'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

function platformLabel(): string {
  if (isImwaldElectron()) return 'desktop-app'
  if (isMobileBrowserProfile()) return 'mobile-web'
  return 'desktop-web'
}

export default function EventArchiveCacheSettings() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(true)
  const [maxMb, setMaxMb] = useState('')
  const [maxEvents, setMaxEvents] = useState('')
  const [sessionLru, setSessionLru] = useState('')

  const defaultsHint = useMemo(() => {
    const p = platformLabel()
    if (p === 'mobile-web') {
      return t('eventArchive.defaultsMobile', {
        lru: EVENT_ARCHIVE_DEFAULTS.sessionLruMobile,
        mb: EVENT_ARCHIVE_DEFAULTS.maxMbMobile,
        ev: EVENT_ARCHIVE_DEFAULTS.maxEventsMobile
      })
    }
    if (p === 'desktop-app') {
      return t('eventArchive.defaultsElectron', {
        lru: EVENT_ARCHIVE_DEFAULTS.sessionLruElectron,
        mb: EVENT_ARCHIVE_DEFAULTS.maxMbElectron,
        ev: EVENT_ARCHIVE_DEFAULTS.maxEventsElectron
      })
    }
    return t('eventArchive.defaultsDesktopWeb', {
      lru: EVENT_ARCHIVE_DEFAULTS.sessionLruDesktopBrowser,
      mb: EVENT_ARCHIVE_DEFAULTS.maxMbDesktopBrowser,
      ev: EVENT_ARCHIVE_DEFAULTS.maxEventsDesktopBrowser
    })
  }, [t])

  useEffect(() => {
    setEnabled(window.localStorage.getItem(StorageKey.EVENT_ARCHIVE_ENABLED) !== 'false')
    setMaxMb(window.localStorage.getItem(StorageKey.EVENT_ARCHIVE_MAX_MB) ?? '')
    setMaxEvents(window.localStorage.getItem(StorageKey.EVENT_ARCHIVE_MAX_EVENTS) ?? '')
    setSessionLru(window.localStorage.getItem(StorageKey.SESSION_EVENT_LRU_MAX) ?? '')
  }, [])

  const apply = useCallback(() => {
    window.localStorage.setItem(StorageKey.EVENT_ARCHIVE_ENABLED, enabled ? 'true' : 'false')
    const mb = maxMb.trim()
    if (mb) window.localStorage.setItem(StorageKey.EVENT_ARCHIVE_MAX_MB, mb)
    else window.localStorage.removeItem(StorageKey.EVENT_ARCHIVE_MAX_MB)
    const ev = maxEvents.trim()
    if (ev) window.localStorage.setItem(StorageKey.EVENT_ARCHIVE_MAX_EVENTS, ev)
    else window.localStorage.removeItem(StorageKey.EVENT_ARCHIVE_MAX_EVENTS)
    const lru = sessionLru.trim()
    if (lru) window.localStorage.setItem(StorageKey.SESSION_EVENT_LRU_MAX, lru)
    else window.localStorage.removeItem(StorageKey.SESSION_EVENT_LRU_MAX)
    client.reapplySessionLruFromSettings()
    invalidateArchiveFootprintCache()
    toast.success(t('eventArchive.appliedToast'))
  }, [enabled, maxMb, maxEvents, sessionLru, t])

  const effective = getEventArchiveConfig()

  return (
    <div className="mt-8 space-y-4 border-t border-border pt-6">
      <h3 className="text-base font-medium">{t('eventArchive.sectionTitle')}</h3>
      <p className="text-muted-foreground text-sm">{t('eventArchive.sectionBlurb')}</p>
      <p className="text-muted-foreground text-xs">{defaultsHint}</p>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="event-archive-enabled" className="text-sm font-normal">
          {t('eventArchive.enablePersist')}
        </Label>
        <Switch
          id="event-archive-enabled"
          checked={enabled}
          onCheckedChange={(v) => setEnabled(Boolean(v))}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="archive-max-mb" className="text-sm font-normal">
            {t('eventArchive.maxMb')}
          </Label>
          <Input
            id="archive-max-mb"
            inputMode="numeric"
            placeholder={String(
              isImwaldElectron()
                ? EVENT_ARCHIVE_DEFAULTS.maxMbElectron
                : isMobileBrowserProfile()
                  ? EVENT_ARCHIVE_DEFAULTS.maxMbMobile
                  : EVENT_ARCHIVE_DEFAULTS.maxMbDesktopBrowser
            )}
            value={maxMb}
            onChange={(e) => setMaxMb(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="archive-max-events" className="text-sm font-normal">
            {t('eventArchive.maxEvents')}
          </Label>
          <Input
            id="archive-max-events"
            inputMode="numeric"
            placeholder={String(
              isImwaldElectron()
                ? EVENT_ARCHIVE_DEFAULTS.maxEventsElectron
                : isMobileBrowserProfile()
                  ? EVENT_ARCHIVE_DEFAULTS.maxEventsMobile
                  : EVENT_ARCHIVE_DEFAULTS.maxEventsDesktopBrowser
            )}
            value={maxEvents}
            onChange={(e) => setMaxEvents(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="session-lru" className="text-sm font-normal">
          {t('eventArchive.sessionLru')}
        </Label>
        <Input
          id="session-lru"
          inputMode="numeric"
          placeholder={String(
            isImwaldElectron()
              ? EVENT_ARCHIVE_DEFAULTS.sessionLruElectron
              : isMobileBrowserProfile()
                ? EVENT_ARCHIVE_DEFAULTS.sessionLruMobile
                : EVENT_ARCHIVE_DEFAULTS.sessionLruDesktopBrowser
          )}
          value={sessionLru}
          onChange={(e) => setSessionLru(e.target.value)}
        />
      </div>

      <p className="text-muted-foreground text-xs">
        {t('eventArchive.effectiveSummary', {
          enabled: effective.enabled ? t('eventArchive.on') : t('eventArchive.off'),
          mb: Math.round(effective.maxBytes / (1024 * 1024)),
          events: effective.maxEvents,
          lru: effective.sessionLruMax
        })}
      </p>

      <Button type="button" variant="secondary" onClick={apply}>
        {t('eventArchive.apply')}
      </Button>
    </div>
  )
}
