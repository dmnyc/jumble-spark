/**
 * NIP-66 relay monitor (client stub).
 * Publishing 30166/10166 runs in the server cron only; this module only exposes isNip66MonitorEnabled() === false
 * and no-op builders so relay-info and bootstrap can keep calling without branching.
 */

import { BIG_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { TRelayInfo } from '@/types'
import { Event as NEvent, finalizeEvent } from 'nostr-tools'
import { ExtendedKind } from '@/constants'
import logger from '@/lib/logger'
import client from '@/services/client.service'

const RELAY_DISCOVERY_KIND = ExtendedKind.RELAY_DISCOVERY
const RELAY_MONITOR_ANNOUNCEMENT_KIND = ExtendedKind.RELAY_MONITOR_ANNOUNCEMENT

let publishedAnnouncementThisSession = false

function getMonitorSecretKey(): Uint8Array | null {
  return null
}

/** False in the client; publishing is done by the server cron. */
export function isNip66MonitorEnabled(): boolean {
  return getMonitorSecretKey() !== null
}

/**
 * Build and sign a kind 30166 relay discovery event from NIP-11–derived relay info.
 * Returns null in the client (signing runs in the server cron).
 */
export function buildAndSignDiscoveryEvent(relayInfo: TRelayInfo): NEvent | null {
  const sk = getMonitorSecretKey()
  if (!sk) return null

  const d = normalizeUrl(relayInfo.url) || relayInfo.url
  const tags: string[][] = [['d', d]]

  if (Array.isArray(relayInfo.supported_nips)) {
    for (const n of relayInfo.supported_nips) {
      tags.push(['N', String(n)])
    }
  }

  const lim = relayInfo.limitation
  if (lim?.auth_required) tags.push(['R', 'auth'])
  else tags.push(['R', '!auth'])
  if (lim?.payment_required) tags.push(['R', 'payment'])
  else tags.push(['R', '!payment'])

  const draft = {
    kind: RELAY_DISCOVERY_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags
  }

  try {
    const event = finalizeEvent(draft, sk)
    return event as NEvent
  } catch (err) {
    logger.warn('NIP-66 monitor: failed to sign 30166 event', { err, url: relayInfo.url })
    return null
  }
}

/**
 * Build and sign a kind 10166 relay monitor announcement.
 * Returns null in the client (handled by server cron).
 */
function buildAndSignMonitorAnnouncement(): NEvent | null {
  const sk = getMonitorSecretKey()
  if (!sk) return null
  const draft = {
    kind: RELAY_MONITOR_ANNOUNCEMENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['frequency', '3600'],
      ['c', 'nip11'],
      ['c', 'ws']
    ]
  }
  try {
    return finalizeEvent(draft, sk) as NEvent
  } catch (err) {
    logger.warn('NIP-66 monitor: failed to sign 10166 event', { err })
    return null
  }
}

/** No-op in the client; 10166 is published by the server cron on startup. */
export function publishMonitorAnnouncementOnce(): void {
  if (publishedAnnouncementThisSession || !isNip66MonitorEnabled()) return
  const event = buildAndSignMonitorAnnouncement()
  if (!event) return
  publishedAnnouncementThisSession = true
  logger.info('NIP-66: publishing monitor announcement (10166)')
  client.publishEvent([...BIG_RELAY_URLS.slice(0, 4)], event).then((res) => {
    if (res.successCount > 0) {
      logger.info('NIP-66: published monitor announcement (10166)', { successCount: res.successCount })
    }
  }).catch((err) => {
    logger.warn('NIP-66: publish monitor announcement failed', { err })
  })
}
