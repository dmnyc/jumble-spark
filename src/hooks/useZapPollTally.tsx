import { FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import {
  parseZapPollEvent,
  tallyZapPollFromReceipts,
  type TZapPollMeta,
  type TZapPollTally
} from '@/lib/zap-poll'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'

function tallyRelayUrls(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of [...SEARCHABLE_RELAY_URLS, ...FAST_READ_RELAY_URLS]) {
    const n = normalizeUrl(u) || u
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out.slice(0, 12)
}

export function useZapPollTally(poll: Event, meta: TZapPollMeta | null) {
  const [receipts, setReceipts] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!meta) return
    setLoading(true)
    setError(null)
    try {
      const urls = tallyRelayUrls()
      const evs = await client.fetchEvents(urls, {
        kinds: [kinds.Zap],
        '#e': [poll.id],
        limit: 500
      })
      setReceipts(evs)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [poll.id, meta])

  useEffect(() => {
    void load()
  }, [load])

  const tally = useMemo((): TZapPollTally | null => {
    if (!meta) return null
    return tallyZapPollFromReceipts(poll, meta, receipts)
  }, [poll, meta, receipts])

  return { receipts, tally, loading, error, reload: load }
}

export function useZapPollMeta(event: Event) {
  return useMemo(() => parseZapPollEvent(event), [event])
}
