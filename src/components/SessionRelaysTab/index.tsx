import client from '@/services/client.service'
import relayInfoService from '@/services/relay-info.service'
import { isHttpRelayUrl } from '@/lib/url'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, CheckCircle2, XCircle, Zap, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TRelayInfo } from '@/types'
import { useNostr } from '@/providers/NostrProvider'

type SessionDebug = {
  strikedUrls: string[]
  scoredRelays: { url: string; successCount: number; avgLatencyMs: number }[]
  presetWorking: string[]
  presetStriked: string[]
}

function loadDebug(): SessionDebug {
  return client.getSessionRelayDebug()
}

export default function SessionRelaysTab() {
  const { t } = useTranslation()
  const { httpRelayListEvent } = useNostr()
  const [debug, setDebug] = useState<SessionDebug | null>(null)
  const [relayInfoByUrl, setRelayInfoByUrl] = useState<Record<string, TRelayInfo | undefined>>({})

  const refresh = useCallback(() => {
    setDebug(loadDebug())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (debug === null) return
    const urls = Array.from(
      new Set([
        ...debug.presetWorking,
        ...debug.presetStriked,
        ...debug.strikedUrls,
        ...debug.scoredRelays.map((r) => r.url)
      ])
    )
    if (urls.length === 0) return
    let cancelled = false
    void relayInfoService.getRelayInfos(urls).then((infos) => {
      if (cancelled) return
      const next: Record<string, TRelayInfo | undefined> = {}
      infos.forEach((info, idx) => {
        next[urls[idx]!] = info
      })
      setRelayInfoByUrl(next)
    })
    return () => {
      cancelled = true
    }
  }, [debug])

  const clearStrikeForUrl = (url: string) => {
    client.clearSessionRelayStrikeForUrl(url)
    refresh()
  }

  const formatRelayAddress = (url: string) => {
    try {
      const u = new URL(url)
      return u.host || url // host keeps explicit port when present
    } catch {
      return url
    }
  }

  const formatRelayLabel = (url: string) => {
    const name = relayInfoByUrl[url]?.name?.trim()
    if (name) return name
    return formatRelayAddress(url)
  }

  const configuredHttpRelayAddresses = useMemo(() => {
    const out = new Set<string>()
    if (!httpRelayListEvent) return out
    for (const tag of httpRelayListEvent.tags) {
      if (tag[0] !== 'r' || !tag[1]) continue
      const raw = tag[1].trim()
      if (!isHttpRelayUrl(raw)) continue
      out.add(formatRelayAddress(raw).toLowerCase())
    }
    return out
  }, [httpRelayListEvent])

  const isHttpRelayEntry = (url: string): boolean => {
    if (isHttpRelayUrl(url)) return true
    const infoUrl = relayInfoByUrl[url]?.url
    if (infoUrl && isHttpRelayUrl(infoUrl)) return true
    return configuredHttpRelayAddresses.has(formatRelayAddress(url).toLowerCase())
  }

  if (debug === null) return null

  const RelayNameWithTransport = ({ url, mono = true }: { url: string; mono?: boolean }) => (
    <span className="min-w-0 inline-flex max-w-full items-center gap-1.5">
      <span className={`min-w-0 truncate ${mono ? 'font-mono' : ''}`} title={url}>
        {formatRelayLabel(url)}
      </span>
      {isHttpRelayEntry(url) ? (
        <span className="shrink-0 rounded border border-border/70 bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
          HTTP
        </span>
      ) : null}
    </span>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {t('Session relays tab description')}
        </p>
        <Button variant="outline" size="sm" onClick={refresh} className="shrink-0">
          <RefreshCw className="h-4 w-4 mr-1" />
          {t('Refresh')}
        </Button>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
          {t('Session relays preset working')}
        </h3>
        <p className="text-muted-foreground text-xs">
          {t('Session relays preset working hint')}
        </p>
        <ul className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm font-mono">
          {debug.presetWorking.length === 0 ? (
            <li className="text-muted-foreground">{t('None')}</li>
          ) : (
            debug.presetWorking.map((url) => (
              <li key={url} className="truncate">
                <RelayNameWithTransport url={url} />
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <XCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          {t('Session relays preset striked')}
        </h3>
        <p className="text-muted-foreground text-xs">
          {t('Session relays preset striked hint')}
        </p>
        <ul className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
          {debug.presetStriked.length === 0 ? (
            <li className="text-muted-foreground">{t('None')}</li>
          ) : (
            debug.presetStriked.map((url) => (
              <li key={url} className="flex items-center justify-between gap-2">
                <RelayNameWithTransport url={url} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-xs"
                  title={t('Session relays clear strike hint')}
                  onClick={() => clearStrikeForUrl(url)}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  {t('Session relays clear strike')}
                </Button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          {t('Session relays scored random')}
        </h3>
        <p className="text-muted-foreground text-xs">
          {t('Session relays scored random hint')}
        </p>
        <ul className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
          {debug.scoredRelays.length === 0 ? (
            <li className="text-muted-foreground">{t('None')}</li>
          ) : (
            debug.scoredRelays.map(({ url, successCount, avgLatencyMs }) => (
              <li key={url} className="flex justify-between items-center gap-2 font-mono">
                <RelayNameWithTransport url={url} />
                <span className="shrink-0 text-muted-foreground text-xs">
                  {successCount} {t('successes')} · ~{avgLatencyMs} ms
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      {debug.strikedUrls.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t('Session relays all striked')}
          </h3>
          <ul className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
            {debug.strikedUrls.map((url) => (
              <li key={url} className="flex items-center justify-between gap-2 text-muted-foreground">
                <RelayNameWithTransport url={url} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-xs text-foreground"
                  title={t('Session relays clear strike hint')}
                  onClick={() => clearStrikeForUrl(url)}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  {t('Session relays clear strike')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
