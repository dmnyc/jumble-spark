import { devProxyLoopbackHttpRelayBase, normalizeHttpRelayUrl, simplifyUrl } from '@/lib/url'
import indexDb from '@/services/indexed-db.service'
import { TAwesomeRelayCollection, TRelayInfo } from '@/types'
import DataLoader from 'dataloader'
import FlexSearch from 'flexsearch'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import logger from '@/lib/logger'

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

  /** Relay info cache TTL: refetch NIP-11 after this long (24h). */
  private static RELAY_INFO_CACHE_TTL_MS = 24 * 60 * 60 * 1000
  /** TTL for entries with NIP-11 text data but no images — retry sooner in case icon/banner were added. */
  private static RELAY_INFO_PARTIAL_CACHE_TTL_MS = 30 * 60 * 1000
  /** Short retry TTL for entries where NIP-11 fetch failed entirely (no name/description/pubkey). */
  private static RELAY_INFO_EMPTY_RETRY_TTL_MS = 5 * 60 * 1000

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
        const res = await fetchWithTimeout(
          'https://raw.githubusercontent.com/CodyTseng/awesome-nostr-relays/master/dist/collections.json',
          { timeoutMs: 20_000 }
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
    const age = Date.now() - at
    // In dev, use a shorter TTL for localhost relay URLs so stale data from proxy misconfigurations
    // (e.g. wrong NIP-11 cached for ws://localhost:7777) self-heals within the same session.
    if (import.meta.env.DEV && /^(ws|wss|http|https):\/\/localhost/.test(relayInfo.url)) {
      return age > 30 * 60 * 1000
    }
    const hasNip11Data = !!(relayInfo.name || relayInfo.description || relayInfo.pubkey)
    if (!hasNip11Data) return age > RelayInfoService.RELAY_INFO_EMPTY_RETRY_TTL_MS
    const hasImages = !!(relayInfo.icon || relayInfo.banner)
    if (!hasImages) return age > RelayInfoService.RELAY_INFO_PARTIAL_CACHE_TTL_MS
    return age > RelayInfoService.RELAY_INFO_CACHE_TTL_MS
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
    return await this.addRelayInfo(relayInfo)
  }

  private async fetchRelayNip11(url: string) {
    try {
      const httpCandidate = url.trim().replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')
      const httpBase = normalizeHttpRelayUrl(httpCandidate) || httpCandidate
      // WS relay NIP-11 must NOT go through the dev proxy — the proxy is fixed to the HTTP index relay
      // port and would return that relay's NIP-11 for any localhost WS relay (wrong data).
      // HTTP index relay URLs do use the proxy to avoid CORS.
      const isWsRelay = /^wss?:\/\//i.test(url.trim())
      const fetchUrl = isWsRelay ? httpBase : devProxyLoopbackHttpRelayBase(httpBase)
      logger.debug('[RelayInfo] Fetching NIP-11', { url, fetchUrl })
      const res = await fetchWithTimeout(fetchUrl, {
        headers: { Accept: 'application/nostr+json' },
        timeoutMs: 12_000
      })
      if (!res.ok) {
        logger.warn('[RelayInfo] NIP-11 fetch failed', { url, status: res.status })
        return undefined
      }
      const data = await res.json() as Omit<TRelayInfo, 'url' | 'shortUrl'>
      logger.info('[RelayInfo] NIP-11 received', {
        url,
        name: data.name,
        icon: data.icon,
        banner: data.banner,
        supported_nips: data.supported_nips
      })
      return data
    } catch (err) {
      logger.warn('[RelayInfo] NIP-11 fetch threw', { url, err })
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
}

const instance = RelayInfoService.getInstance()
export default instance
