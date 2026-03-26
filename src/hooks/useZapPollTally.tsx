import { FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import {
  parseZapPollEvent,
  tallyZapPollFromReceipts,
  type TZapPollMeta,
  type TZapPollTally
} from '@/lib/zap-poll'
import { peekZapPollTallyReceipts, storeZapPollTallyReceipts } from '@/lib/zap-poll-tally-cache'
import { normalizeUrl } from '@/lib/url'
import client, { eventService } from '@/services/client.service'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

/** Zap receipts for a poll often live on relays hinted on the poll’s `p` tags, not only the global read set. */
function tallyRelayUrls(meta: TZapPollMeta): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (raw: string) => {
    const n = normalizeUrl(raw) || raw?.trim()
    if (!n || seen.has(n)) return
    seen.add(n)
    out.push(n)
  }
  for (const r of meta.recipients) {
    push(r.relay)
  }
  for (const u of [...SEARCHABLE_RELAY_URLS, ...FAST_READ_RELAY_URLS]) {
    push(u)
  }
  return out.slice(0, 28)
}

function normalizePollHexId(id: string): string | null {
  const k = id.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(k) ? k : null
}

function dedupeReceipts(lists: Event[]): Event[] {
  const byId = new Map<string, Event>()
  for (const ev of lists) {
    if (!byId.has(ev.id)) byId.set(ev.id, ev)
  }
  return [...byId.values()]
}

function seedReceiptsFromSession(pollKey: string): { seeded: Event[]; hadWarmList: boolean } {
  const cached = peekZapPollTallyReceipts(pollKey)
  const sessionEvs = eventService.getSessionZapReceiptsForTargetEventId(pollKey)
  const seeded = dedupeReceipts([...(cached ?? []), ...sessionEvs])
  const hadWarmList = cached !== undefined || sessionEvs.length > 0
  return { seeded, hadWarmList }
}

export function useZapPollTally(poll: Event, meta: TZapPollMeta | null) {
  const [receipts, setReceipts] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Ignore stale fetch results when `poll.id` changes mid-request. */
  const activePollKeyRef = useRef<string | null>(null)
  activePollKeyRef.current = normalizePollHexId(poll.id)

  /** Before paint: session tally cache + session LRU zaps so drawer matches feed immediately. */
  useLayoutEffect(() => {
    if (!meta) {
      setReceipts([])
      setLoading(false)
      setError(null)
      return
    }
    const pollKey = normalizePollHexId(poll.id)
    if (!pollKey) {
      setLoading(false)
      return
    }
    const { seeded, hadWarmList } = seedReceiptsFromSession(pollKey)
    setReceipts(seeded)
    setLoading(!hadWarmList && seeded.length === 0)
    setError(null)
  }, [poll.id, meta])

  const load = useCallback(async () => {
    if (!meta) {
      setLoading(false)
      return
    }
    const pollKey = normalizePollHexId(poll.id)
    if (!pollKey) {
      setLoading(false)
      return
    }

    const { seeded, hadWarmList } = seedReceiptsFromSession(pollKey)
    setReceipts(seeded)
    if (!hadWarmList && seeded.length === 0) {
      setLoading(true)
    }
    setError(null)

    try {
      const urls = tallyRelayUrls(meta)
      const evs = await client.fetchEvents(urls, {
        kinds: [kinds.Zap],
        '#e': [poll.id],
        limit: 500
      })
      if (activePollKeyRef.current !== pollKey) return
      const merged = dedupeReceipts([...seeded, ...evs])
      setReceipts(merged)
      storeZapPollTallyReceipts(pollKey, merged)
    } catch (e) {
      if (activePollKeyRef.current !== pollKey) return
      if (!hadWarmList && seeded.length === 0) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (activePollKeyRef.current === pollKey) {
        setLoading(false)
      }
    }
  }, [poll.id, meta])

  useEffect(() => {
    if (!meta) return
    if (!normalizePollHexId(poll.id)) return
    void load()
  }, [load, meta, poll.id])

  const tally = useMemo((): TZapPollTally | null => {
    if (!meta) return null
    return tallyZapPollFromReceipts(poll, meta, receipts)
  }, [poll, meta, receipts])

  return { receipts, tally, loading, error, reload: load }
}

export function useZapPollMeta(event: Event) {
  return useMemo(() => parseZapPollEvent(event), [event])
}
