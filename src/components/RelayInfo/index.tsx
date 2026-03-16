import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useFetchRelayInfo } from '@/hooks'
import { normalizeHttpUrl } from '@/lib/url'
import client from '@/services/client.service'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { nip66Service } from '@/services/nip66.service'
import { Check, Copy, GitBranch, Link, Mail, SquareCode, Activity } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import PostEditor from '../PostEditor'
import RelayIcon from '../RelayIcon'
import SaveRelayDropdownMenu from '../SaveRelayDropdownMenu'
import UserAvatar from '../UserAvatar'
import Username from '../Username'
import RelayReviewsPreview from './RelayReviewsPreview'
import type { TNip66RelayDiscovery } from '@/types'

export default function RelayInfo({ url, className }: { url: string; className?: string }) {
  const { t } = useTranslation()
  const { checkLogin } = useNostr()
  const { relayInfo, isFetching } = useFetchRelayInfo(url)
  const [open, setOpen] = useState(false)
  const [discovery, setDiscovery] = useState<TNip66RelayDiscovery | undefined>(() => nip66Service.getDiscovery(url))

  useEffect(() => {
    setDiscovery(nip66Service.getDiscovery(url))
    let cancelled = false
    nip66Service.getDiscoveryCached(url).then((cached) => {
      if (!cancelled && cached) setDiscovery(cached)
    })
    nip66Service.isDiscoveryStaleForRelay(url).then((stale) => {
      if (cancelled) return
      if (stale) {
        client.fetchNip66DiscoveryForRelay(url).then(() => {
          if (!cancelled) setDiscovery(nip66Service.getDiscovery(url))
        })
      }
    })
    return () => { cancelled = true }
  }, [url])

  if (isFetching || !relayInfo) {
    return null
  }

  return (
    <div className={cn('space-y-4 mb-2', className)}>
      <div className="px-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 justify-between">
            <div className="flex gap-2 items-center truncate">
              <RelayIcon url={url} className="w-8 h-8" />
              <div className="text-2xl font-semibold truncate select-text">
                {relayInfo.name || relayInfo.shortUrl}
              </div>
            </div>
            <RelayControls url={relayInfo.url} />
          </div>
          {!!relayInfo.tags?.length && (
            <div className="flex gap-2">
              {relayInfo.tags.map((tag) => (
                <Badge variant="secondary">{tag}</Badge>
              ))}
            </div>
          )}
          {relayInfo.description && (
            <div className="text-wrap break-words whitespace-pre-wrap mt-2 select-text">
              {relayInfo.description}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold text-muted-foreground">{t('Homepage')}</div>
          <a
            href={normalizeHttpUrl(relayInfo.url)}
            target="_blank"
            className="hover:underline text-primary select-text truncate block"
          >
            {normalizeHttpUrl(relayInfo.url)}
          </a>
        </div>

        <ScrollArea className="overflow-x-auto">
          <div className="flex gap-8 pb-2">
            {relayInfo.pubkey && (
              <div className="space-y-2 w-fit">
                <div className="text-sm font-semibold text-muted-foreground">{t('Operator')}</div>
                <div className="flex gap-2 items-center">
                  <UserAvatar userId={relayInfo.pubkey} size="small" />
                  <Username userId={relayInfo.pubkey} className="font-semibold text-nowrap" />
                </div>
              </div>
            )}
            {relayInfo.contact && (
              <div className="space-y-2 w-fit">
                <div className="text-sm font-semibold text-muted-foreground">{t('Contact')}</div>
                <div className="flex gap-2 items-center font-semibold select-text text-nowrap">
                  <Mail />
                  {relayInfo.contact}
                </div>
              </div>
            )}
            {relayInfo.software && (
              <div className="space-y-2 w-fit">
                <div className="text-sm font-semibold text-muted-foreground">{t('Software')}</div>
                <div className="flex gap-2 items-center font-semibold select-text text-nowrap">
                  <SquareCode />
                  {formatSoftware(relayInfo.software)}
                </div>
              </div>
            )}
            {relayInfo.version && (
              <div className="space-y-2 w-fit">
                <div className="text-sm font-semibold text-muted-foreground">{t('Version')}</div>
                <div className="flex gap-2 items-center font-semibold select-text text-nowrap">
                  <GitBranch />
                  {relayInfo.version}
                </div>
              </div>
            )}
            {typeof window !== 'undefined' && window.__RUNTIME_CONFIG__?.NIP66_MONITOR_NPUB && (
              <div className="space-y-2 w-fit">
                <div className="text-sm font-semibold text-muted-foreground">{t('Relay monitor (NIP-66)')}</div>
                <div className="flex gap-2 items-center">
                  <UserAvatar userId={window.__RUNTIME_CONFIG__.NIP66_MONITOR_NPUB} size="small" />
                  <Username userId={window.__RUNTIME_CONFIG__.NIP66_MONITOR_NPUB} className="font-semibold text-nowrap" />
                </div>
              </div>
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        {discovery && (
          <RelayLivelinessSection discovery={discovery} />
        )}
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => checkLogin(() => setOpen(true))}
        >
          {t('Share something on this Relay')}
        </Button>
        <PostEditor open={open} setOpen={setOpen} openFrom={[relayInfo.url]} />
      </div>
      <RelayReviewsPreview relayUrl={url} />
    </div>
  )
}

function formatSoftware(software: string) {
  const parts = software.split('/')
  return parts[parts.length - 1]
}

function RelayLivelinessSection({ discovery }: { discovery: TNip66RelayDiscovery }) {
  const { t } = useTranslation()
  const req = discovery.requirements
  const hasRtt =
    discovery.rttOpenMs != null || discovery.rttReadMs != null || discovery.rttWriteMs != null
  const hasMeta = !!(discovery.networkType ?? discovery.relayType ?? (discovery.topics?.length ?? 0) > 0)
  const lastReported = useMemo(
    () => (discovery.created_at ? new Date(discovery.created_at * 1000).toLocaleString() : null),
    [discovery.created_at]
  )
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Activity className="h-4 w-4" />
        {t('Relay liveliness (NIP-66)')}
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant={req.auth === true ? 'secondary' : 'default'}>
          {req.auth === true ? t('Auth required') : t('Public (no auth)')}
        </Badge>
        <Badge variant={req.payment === true ? 'secondary' : 'default'}>
          {req.payment === true ? t('Payment required') : t('No payment')}
        </Badge>
        {req.writes !== undefined && (
          <Badge variant="outline">
            {req.writes ? t('Writes required') : t('Writes open')}
          </Badge>
        )}
        {req.pow !== undefined && (
          <Badge variant="outline">
            {req.pow ? t('PoW required') : t('No PoW')}
          </Badge>
        )}
      </div>
      {hasRtt && (
        <div className="flex flex-wrap gap-4 text-sm">
          {discovery.rttOpenMs != null && (
            <span>
              {t('RTT open')}: {discovery.rttOpenMs} ms
            </span>
          )}
          {discovery.rttReadMs != null && (
            <span>
              {t('RTT read')}: {discovery.rttReadMs} ms
            </span>
          )}
          {discovery.rttWriteMs != null && (
            <span>
              {t('RTT write')}: {discovery.rttWriteMs} ms
            </span>
          )}
        </div>
      )}
      {discovery.supportedNips?.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{t('Supported NIPs (from monitor)')}</div>
          <div className="flex flex-wrap gap-1">
            {discovery.supportedNips.slice().sort((a, b) => a - b).map((nip) => (
              <Badge key={nip} variant="outline" className="text-xs">
                NIP-{nip}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {hasMeta && (
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          {discovery.networkType && <span>{t('Network')}: {discovery.networkType}</span>}
          {discovery.relayType && <span>{t('Type')}: {discovery.relayType}</span>}
          {discovery.topics?.length ? (
            <span>{t('Topics')}: {discovery.topics.join(', ')}</span>
          ) : null}
        </div>
      )}
      {lastReported && (
        <div className="text-xs text-muted-foreground">
          {t('Last reported by monitor')}: {lastReported}
        </div>
      )}
      {(() => {
        const monitorUserId = discovery.monitorPubkey ?? (typeof window !== 'undefined' ? window.__RUNTIME_CONFIG__?.NIP66_MONITOR_NPUB : undefined)
        return monitorUserId ? (
          <div className="space-y-1 pt-1 border-t border-border/50">
            <div className="text-xs font-medium text-muted-foreground">{t('Relay monitor (NIP-66)')}</div>
            <div className="flex gap-2 items-center">
              <UserAvatar userId={monitorUserId} size="small" />
              <Username userId={monitorUserId} className="font-semibold text-nowrap" />
            </div>
          </div>
        ) : null
      })()}
    </div>
  )
}

function RelayControls({ url }: { url: string }) {
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedShareableUrl, setCopiedShareableUrl] = useState(false)

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(url)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  const handleCopyShareableUrl = () => {
    navigator.clipboard.writeText(`https://jumble.social/?r=${url}`)
    setCopiedShareableUrl(true)
    toast.success('Shareable URL copied to clipboard')
    setTimeout(() => setCopiedShareableUrl(false), 2000)
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="titlebar-icon" onClick={handleCopyShareableUrl}>
        {copiedShareableUrl ? <Check /> : <Link />}
      </Button>
      <Button variant="ghost" size="titlebar-icon" onClick={handleCopyUrl}>
        {copiedUrl ? <Check /> : <Copy />}
      </Button>
      <SaveRelayDropdownMenu urls={[url]} bigButton />
    </div>
  )
}
