import { BIG_RELAY_URLS } from '@/constants'
import { simplifyUrl } from '@/lib/url'
import indexDb from '@/services/indexed-db.service'
import { TAwesomeRelayCollection, TRelayInfo } from '@/types'
import DataLoader from 'dataloader'
import FlexSearch from 'flexsearch'
import logger from '@/lib/logger'
import client from '@/services/client.service'
import { nip66Service } from '@/services/nip66.service'
import { buildAndSignDiscoveryEvent, isNip66MonitorEnabled } from '@/services/nip66-monitor'

class RelayInfoService {
  static instance: RelayInfoService

  public static getInstance(): RelayInfoService {
    if (!RelayInfoService.instance) {
      RelayInfoService.instance = new RelayInfoService()
    }
    return RelayInfoService.instance
  }

  private initPromise: Promise<void> | null = null
  private awesomeRelayCollections: Promise<TAwesomeRelayCollection[]> | null = null
  private relayInfoMap = new Map<string, TRelayInfo>()
  private relayInfoIndex = new FlexSearch.Index({
    tokenize: 'forward',
    encode: (str) =>
      str
        // eslint-disable-next-line no-control-regex
        .replace(/[^\x00-\x7F]/g, (match) => ` ${match} `)
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
  })
  private fetchDataloader = new DataLoader<string, TRelayInfo | undefined>(
    async (urls) => {
      const results = await Promise.allSettled(urls.map((url) => this._getRelayInfo(url)))
      return results.map((res) => (res.status === 'fulfilled' ? res.value : undefined))
    },
    { maxBatchSize: 1 }
  )
  private relayUrlsForRandom: string[] = []
  /** NIP-66: throttle publishing 30166 per relay (min interval 1 hour). */
  private lastNip66PublishByUrl = new Map<string, number>()
  private static NIP66_PUBLISH_INTERVAL_MS = 60 * 60 * 1000

  /** Relay info cache TTL: refetch NIP-11 after this long (24h). */
  private static RELAY_INFO_CACHE_TTL_MS = 24 * 60 * 60 * 1000

  async search(query: string) {
    if (this.initPromise) {
      await this.initPromise
    }

    if (!query) {
      const arr = Array.from(this.relayInfoMap.values())
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    }

    const result = await this.relayInfoIndex.searchAsync(query)
    return result.map((url) => this.relayInfoMap.get(url as string)).filter(Boolean) as TRelayInfo[]
  }

  async getRelayInfos(urls: string[]) {
    if (urls.length === 0) {
      return []
    }
    const relayInfos = await this.fetchDataloader.loadMany(urls)
    return relayInfos.map((relayInfo) => (relayInfo instanceof Error ? undefined : relayInfo))
  }

  async getRelayInfo(url: string) {
    return this.fetchDataloader.load(url)
  }

  async getRandomRelayInfos(count: number) {
    if (this.initPromise) {
      await this.initPromise
    }

    const relayInfos: TRelayInfo[] = []
    while (relayInfos.length < count) {
      const randomIndex = Math.floor(Math.random() * this.relayUrlsForRandom.length)
      const url = this.relayUrlsForRandom[randomIndex]
      this.relayUrlsForRandom.splice(randomIndex, 1)
      if (this.relayUrlsForRandom.length === 0) {
        this.relayUrlsForRandom = Array.from(this.relayInfoMap.keys())
      }

      const relayInfo = this.relayInfoMap.get(url)
      if (relayInfo) {
        relayInfos.push(relayInfo)
      }
    }
    return relayInfos
  }

  async getAwesomeRelayCollections() {
    if (this.awesomeRelayCollections) return this.awesomeRelayCollections

    this.awesomeRelayCollections = (async () => {
      try {
        const res = await fetch(
          'https://raw.githubusercontent.com/CodyTseng/awesome-nostr-relays/master/dist/collections.json'
        )
        if (!res.ok) {
          throw new Error('Failed to fetch awesome relay collections')
        }
        const data = (await res.json()) as { collections: TAwesomeRelayCollection[] }
        return data.collections
      } catch (error) {
        logger.error('Error fetching awesome relay collections', { error })
        return []
      }
    })()

    return this.awesomeRelayCollections
  }

  private isStale(relayInfo: TRelayInfo): boolean {
    const at = relayInfo.cachedAt
    if (at == null) return true
    return Date.now() - at > RelayInfoService.RELAY_INFO_CACHE_TTL_MS
  }

  private async _getRelayInfo(url: string) {
    const exist = this.relayInfoMap.get(url)
    if (exist && !this.isStale(exist)) {
      return exist
    }
    if (exist && this.isStale(exist)) {
      this.relayInfoMap.delete(url)
    }

    const storedRelayInfo = await indexDb.getRelayInfo(url)
    if (storedRelayInfo && !this.isStale(storedRelayInfo)) {
      return await this.addRelayInfo(storedRelayInfo)
    }

    const nip11 = await this.fetchRelayNip11(url)
    const relayInfo: TRelayInfo = {
      ...(nip11 ?? {}),
      url,
      shortUrl: simplifyUrl(url)
    }
    const added = await this.addRelayInfo(relayInfo)
    this.maybePublishNip66Discovery(added)
    return added
  }

  private async fetchRelayNip11(url: string) {
    try {
      logger.debug('Fetching NIP-11 metadata', { url })
      const res = await fetch(url.replace('ws://', 'http://').replace('wss://', 'https://'), {
        headers: { Accept: 'application/nostr+json' }
      })
      return res.json() as Omit<TRelayInfo, 'url' | 'shortUrl'>
    } catch {
      return undefined
    }
  }

  private async addRelayInfo(relayInfo: TRelayInfo) {
    if (!Array.isArray(relayInfo.supported_nips)) {
      relayInfo.supported_nips = []
    }
    relayInfo.cachedAt = relayInfo.cachedAt ?? Date.now()

    this.relayInfoMap.set(relayInfo.url, relayInfo)
    await Promise.allSettled([
      this.relayInfoIndex.addAsync(
        relayInfo.url,
        [
          relayInfo.shortUrl,
          ...relayInfo.shortUrl.split('.'),
          relayInfo.name ?? '',
          relayInfo.description ?? ''
        ].join(' ')
      ),
      indexDb.putRelayInfo(relayInfo)
    ])
    return relayInfo
  }

  /**
   * When monitor nsec is set: publish a kind 30166 for this relay after we've fetched NIP-11
   * (only when the fetch was from the network, not from cache). Throttled to once per hour per relay.
   * Triggered whenever getRelayInfo/getRelayInfos causes a fresh NIP-11 fetch (e.g. first time
   * opening a relay, or relay not in IndexedDB).
   */
  private maybePublishNip66Discovery(relayInfo: TRelayInfo): void {
    if (!isNip66MonitorEnabled()) {
      logger.debug('NIP-66: skip 30166 (publishing is handled by server cron)', { url: relayInfo.url })
      return
    }
    const key = relayInfo.url
    const now = Date.now()
    const last = this.lastNip66PublishByUrl.get(key) ?? 0
    if (now - last < RelayInfoService.NIP66_PUBLISH_INTERVAL_MS) {
      logger.debug('NIP-66: skip 30166 (throttled, 1h per relay)', { url: relayInfo.url, nextInMin: Math.ceil((RelayInfoService.NIP66_PUBLISH_INTERVAL_MS - (now - last)) / 60000) })
      return
    }

    const event = buildAndSignDiscoveryEvent(relayInfo)
    if (!event) {
      logger.debug('NIP-66: skip 30166 (build/sign failed)', { url: relayInfo.url })
      return
    }

    this.lastNip66PublishByUrl.set(key, now)
    const urls = [relayInfo.url, ...BIG_RELAY_URLS.slice(0, 3)]
    logger.info('NIP-66: publishing relay discovery (30166)', { url: relayInfo.url })
    client.publishEvent(urls, event).then((res) => {
      if (res.successCount > 0) {
        nip66Service.addDiscoveryFromRelayInfo(relayInfo)
        logger.info('NIP-66: published relay discovery (30166)', { url: relayInfo.url, successCount: res.successCount })
      } else {
        logger.info('NIP-66: relay discovery (30166) not accepted by any relay', { url: relayInfo.url })
      }
    }).catch((err) => {
      logger.warn('NIP-66: publish relay discovery failed', { url: relayInfo.url, err })
    })
  }
}

const instance = RelayInfoService.getInstance()
export default instance
