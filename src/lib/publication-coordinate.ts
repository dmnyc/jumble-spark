/** Split `kind:64-hex-pubkey:d…` (d may contain `:`). */
export function splitPublicationCoordinate(coordinate: string): {
  kind: number
  pubkey: string
  d: string
} | null {
  const trimmed = coordinate.trim()
  const i0 = trimmed.indexOf(':')
  const i1 = trimmed.indexOf(':', i0 + 1)
  if (i0 < 1 || i1 <= i0 + 1) return null
  const kind = parseInt(trimmed.slice(0, i0), 10)
  if (Number.isNaN(kind)) return null
  const pubkeyRaw = trimmed.slice(i0 + 1, i1)
  if (!/^[0-9a-fA-F]{64}$/.test(pubkeyRaw)) return null
  const pubkey = pubkeyRaw.toLowerCase()
  const d = trimmed.slice(i1 + 1)
  return { kind, pubkey, d }
}

/**
 * Coordinate strings to try when matching index `a` tags to events (NFC/NFD on `d` only).
 * Relays filter `#d` on exact bytes; we still need flexible client-side matching after REQ.
 */
export function publicationCoordinateLookupKeys(coordinate: string): string[] {
  const p = splitPublicationCoordinate(coordinate)
  if (!p) return [coordinate.trim()]
  const ds = [...new Set([p.d, p.d.normalize('NFC'), p.d.normalize('NFD')])]
  return [...new Set(ds.map((dt) => `${p.kind}:${p.pubkey}:${dt}`))]
}
