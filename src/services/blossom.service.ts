import { BoundedMap } from '@/lib/bounded-map'
import { isBlossomUri } from '@/lib/blossom-uri'
import blossomCache from '@/services/blossom-cache.service'
import blossomUriResolver from '@/services/blossom-uri-resolver.service'
import client from '@/services/client.service'
import { getHashFromURL } from 'blossom-client-sdk'

class BlossomService {
  static instance: BlossomService
  private cacheMap = new BoundedMap<
    string,
    {
      pubkey?: string
      resolve: (url: string) => void
      promise: Promise<string>
      tried: Set<string>
      url: string
      validUrl?: string
    }
  >({ maxSize: 2_000 })

  constructor() {
    if (!BlossomService.instance) {
      BlossomService.instance = this
    }
    return BlossomService.instance
  }

  peekValidUrl(url: string, pubkey?: string): string {
    if (isBlossomUri(url)) {
      return blossomUriResolver.peek(url) ?? url
    }
    const cache = this.cacheMap.get(url)
    if (cache?.validUrl) {
      return cache.validUrl
    }
    const localUrl = blossomCache.rewriteUrl(url, pubkey)
    return localUrl ?? url
  }

  async getValidUrl(url: string, pubkey?: string): Promise<string> {
    if (isBlossomUri(url)) {
      // The URI names no server: resolve it against its own `xs` hints (plus
      // the author's kind:10063 list), verifying the blob's hash. Returns the
      // URI itself when nothing checks out, so callers fall through to their
      // error handling.
      const extraServers = pubkey ? await client.fetchBlossomServerList(pubkey).catch(() => []) : []
      return (await blossomUriResolver.resolve(url, extraServers)) ?? url
    }

    const cache = this.cacheMap.get(url)
    if (cache) {
      return cache.validUrl ?? cache.url
    }

    let resolveFunc: (url: string) => void
    const promise = new Promise<string>((resolve) => {
      resolveFunc = resolve
    })
    const tried = new Set<string>()

    const localUrl = blossomCache.rewriteUrl(url, pubkey)
    if (localUrl) {
      this.cacheMap.set(url, { pubkey, resolve: resolveFunc!, promise, tried, url: localUrl })
      const cacheHostname = blossomCache.hostname
      if (cacheHostname) {
        tried.add(cacheHostname)
      }
      return localUrl
    }

    this.cacheMap.set(url, { pubkey, resolve: resolveFunc!, promise, tried, url })
    try {
      const u = new URL(url)
      tried.add(u.hostname)
    } catch {
      // ignore
    }
    return url
  }

  async tryNextUrl(originalUrl: string): Promise<string | null> {
    const entry = this.cacheMap.get(originalUrl)
    if (!entry) {
      return null
    }

    if (entry.validUrl) {
      return entry.validUrl
    }

    const { pubkey, tried, resolve } = entry
    let oldImageUrl: URL | undefined
    let hash: string | null = null
    try {
      oldImageUrl = new URL(originalUrl)
      hash = getHashFromURL(oldImageUrl)
    } catch (error) {
      console.error('Invalid image URL:', error)
    }

    if (oldImageUrl && !tried.has(oldImageUrl.hostname)) {
      tried.add(oldImageUrl.hostname)
      return originalUrl
    }

    if (!pubkey || !hash || !oldImageUrl) {
      resolve(originalUrl)
      return null
    }

    const ext = oldImageUrl.pathname.match(/\.\w+$/i)

    const blossomServerList = await client.fetchBlossomServerList(pubkey)
    const urls = blossomServerList
      .map((server) => {
        try {
          return new URL(server)
        } catch (error) {
          console.error('Invalid Blossom server URL:', server, error)
          return undefined
        }
      })
      .filter((url) => !!url && !tried.has(url.hostname))
    const nextUrl = urls[0]
    if (!nextUrl) {
      resolve(originalUrl)
      return null
    }

    tried.add(nextUrl.hostname)
    nextUrl.pathname = '/' + hash + ext
    return nextUrl.toString()
  }

  markAsSuccess(originalUrl: string, successUrl: string) {
    // The URI resolver caches blossom URIs on verified resolution; an <img>
    // load event adds nothing it doesn't already know.
    if (isBlossomUri(originalUrl)) {
      return
    }
    const entry = this.cacheMap.get(originalUrl)
    if (!entry) {
      this.cacheMap.set(originalUrl, {
        resolve: () => {},
        promise: Promise.resolve(successUrl),
        tried: new Set<string>(),
        url: successUrl,
        validUrl: successUrl
      })
      return
    }

    entry.resolve(successUrl)
    entry.validUrl = successUrl
  }
}

const instance = new BlossomService()
export default instance
