import { LRUCache } from 'lru-cache'
import { isValidPubkey } from './pubkey'
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

  try {
    const res = await fetch(getWellKnownNip05Url(nip05Domain, nip05Name))
    const json = await res.json()
    if (json.names?.[nip05Name] === pubkey) {
      // Also extract relays if available (NIP-05 spec allows a relays object)
      const relays = json.relays?.[pubkey]
      return { ...result, isVerified: true, relays: Array.isArray(relays) ? relays : undefined }
    }
  } catch {
    // ignore
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

export async function fetchPubkeysFromDomain(domain: string): Promise<string[]> {
  try {
    const res = await fetch(getWellKnownNip05Url(domain))
    const json = await res.json()
    const pubkeySet = new Set<string>()
    return Object.values(json.names || {}).filter((pubkey) => {
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
