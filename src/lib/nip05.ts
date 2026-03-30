import { LRUCache } from 'lru-cache'
import { buildViteProxySitesFetchUrl } from '@/lib/vite-proxy-url'
import { isValidPubkey } from './pubkey'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import logger from '@/lib/logger'

type TVerifyNip05Result = {
  isVerified: boolean
  nip05Name: string
  nip05Domain: string
  relays?: string[]
}

function asNip05LookupString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (Array.isArray(value)) {
    for (const x of value) {
      if (typeof x === 'string' && x.trim()) return x
    }
    return ''
  }
  return String(value)
}

const verifyNip05ResultCache = new LRUCache<string, TVerifyNip05Result>({
  max: 1000,
  fetchMethod: (key) => {
    const { nip05, pubkey } = JSON.parse(key) as { nip05?: unknown; pubkey?: unknown }
    return _verifyNip05(asNip05LookupString(nip05), typeof pubkey === 'string' ? pubkey : '')
  }
})

async function _verifyNip05(nip05: string, pubkey: string): Promise<TVerifyNip05Result> {
  const nip05Str = asNip05LookupString(nip05)
  const parts = nip05Str ? nip05Str.split('@') : []
  const nip05Name = parts[0]
  const nip05Domain = parts[1]
  const result: TVerifyNip05Result = { isVerified: false, nip05Name, nip05Domain }
  if (!nip05Name || !nip05Domain || !pubkey) return result

  const json = await fetchWellKnownNostrJson(nip05Domain, nip05Name)
  if (json) {
    const names = json.names as Record<string, string> | undefined
    if (names?.[nip05Name] === pubkey) {
      const relays = json.relays as Record<string, unknown> | undefined
      const relayList = relays?.[pubkey]
      return { ...result, isVerified: true, relays: Array.isArray(relayList) ? relayList : undefined }
    }
  }
  return result
}

export async function verifyNip05(nip05: string, pubkey: string): Promise<TVerifyNip05Result> {
  const nip05Str = asNip05LookupString(nip05)
  const pubkeyStr = typeof pubkey === 'string' ? pubkey : ''
  const result = await verifyNip05ResultCache.fetch(JSON.stringify({ nip05: nip05Str, pubkey: pubkeyStr }))
  if (result) {
    return result
  }
  const parts = nip05Str ? nip05Str.split('@') : []
  return { isVerified: false, nip05Name: parts[0], nip05Domain: parts[1] }
}

export function getWellKnownNip05Url(domain: string, name?: string): string {
  const url = new URL('/.well-known/nostr.json', `https://${domain}`)
  if (name) {
    url.searchParams.set('name', name)
  }
  return url.toString()
}

/**
 * Fetch `/.well-known/nostr.json` in the browser without tripping third-party CORS:
 * when `VITE_PROXY_SERVER` is set (production), use same-origin `/sites/?url=…` like OG preview.
 */
async function fetchWellKnownNostrJson(domain: string, name?: string): Promise<Record<string, unknown> | null> {
  const targetUrl = getWellKnownNip05Url(domain, name)
  const proxyServer = import.meta.env.VITE_PROXY_SERVER?.trim()
  const fetchUrl = proxyServer ? buildViteProxySitesFetchUrl(targetUrl, proxyServer) : targetUrl
  try {
    const res = await fetchWithTimeout(fetchUrl, {
      credentials: 'omit',
      headers: { Accept: 'application/json, text/plain;q=0.9,*/*;q=0.8' },
      timeoutMs: 15_000
    })
    if (!res.ok) return null
    const data: unknown = await res.json()
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function fetchPubkeysFromDomain(domain: string): Promise<string[]> {
  try {
    const json = await fetchWellKnownNostrJson(domain)
    if (!json) return []
    const pubkeySet = new Set<string>()
    return Object.values((json.names as Record<string, string>) || {}).filter((pubkey) => {
      if (typeof pubkey !== 'string' || !isValidPubkey(pubkey)) {
        return false
      }
      if (pubkeySet.has(pubkey)) {
        return false
      }
      pubkeySet.add(pubkey)
      return true
    }) as string[]
  } catch (error) {
    logger.error('Error fetching pubkeys from domain', { error, domain })
    return []
  }
}

/**
 * Attempt to get relays from NIP-07 extension
 * Some extensions support a getRelays() method
 */
export async function getRelaysFromNip07Extension(): Promise<string[]> {
  try {
    if (window.nostr && typeof window.nostr.getRelays === 'function') {
      const relaysObj = await window.nostr.getRelays()
      // getRelays() returns an object like { "wss://relay.url": {read: true, write: true} }
      return Object.keys(relaysObj || {})
    }
  } catch (error) {
    logger.warn('NIP-07 extension does not support getRelays()', error as Error)
  }
  return []
}
