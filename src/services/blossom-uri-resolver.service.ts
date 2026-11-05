import { BoundedMap } from '@/lib/bounded-map'
import { blossomCandidateUrl, parseBlossomUri } from '@/lib/blossom-uri'

const CACHE_MAX_SIZE = 2_000
const MISS_TTL_MS = 5 * 60 * 1000
const PROBE_TIMEOUT_MS = 15_000

/**
 * Resolves BUD-10 `blossom:` URIs to concrete https URLs by fetching the
 * blob from the servers that might hold it — the URI's own `xs` hints first,
 * then any caller-supplied servers (e.g. the author's kind:10063 list) — on
 * the BUD-01 route (`https://<server>/<sha256>`), and verifying each
 * download's SHA-256 against the URI's hash before trusting it: the URI is
 * content-addressed, so a server answering 200 with the wrong bytes (a
 * placeholder, a "404 image", or a planted blob) is rejected and the next
 * candidate is tried. Candidates are tried sequentially so a bad server
 * costs one download, not N. Resolutions are cached per URI (a note's
 * inline image, gallery tile and lightbox can all ask in one render) and
 * misses for five minutes, so an unreachable blob isn't re-fetched on every
 * scroll.
 */
class BlossomUriResolverService {
  static instance: BlossomUriResolverService
  private resolved = new BoundedMap<string, string>({ maxSize: CACHE_MAX_SIZE })
  private misses = new BoundedMap<string, number>({ maxSize: CACHE_MAX_SIZE })
  private inFlight = new Map<string, Promise<string | null>>()

  constructor() {
    if (!BlossomUriResolverService.instance) {
      BlossomUriResolverService.instance = this
    }
    return BlossomUriResolverService.instance
  }

  peek(url: string): string | undefined {
    return this.resolved.get(url)
  }

  async resolve(url: string, extraServers: string[] = []): Promise<string | null> {
    const hit = this.resolved.get(url)
    if (hit) return hit

    const missedAt = this.misses.get(url)
    if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) return null

    const pending = this.inFlight.get(url)
    if (pending) return pending

    const task = this.resolveCandidates(url, extraServers).finally(() => {
      this.inFlight.delete(url)
    })
    this.inFlight.set(url, task)
    return task
  }

  private async resolveCandidates(url: string, extraServers: string[]): Promise<string | null> {
    const uri = parseBlossomUri(url)
    if (!uri) return null

    const servers = [...new Set([...uri.serverHints, ...extraServers])]
    for (const server of servers) {
      const candidateUrl = blossomCandidateUrl(uri, server)
      if (await this.fetchAndVerify(candidateUrl, uri.sha256)) {
        this.misses.delete(url)
        this.resolved.set(url, candidateUrl)
        return candidateUrl
      }
    }
    this.misses.set(url, Date.now())
    return null
  }

  private async fetchAndVerify(url: string, sha256: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
      let body: ArrayBuffer
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) return false
        body = await response.arrayBuffer()
      } finally {
        clearTimeout(timer)
      }
      const digest = await crypto.subtle.digest('SHA-256', body)
      const hex = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      // The URI's hash is the blob's identity — a server that serves anything
      // else (placeholder, 404 page, planted content) is not the blob's host.
      return hex === sha256.toLowerCase()
    } catch {
      return false
    }
  }
}

const instance = new BlossomUriResolverService()
export default instance
