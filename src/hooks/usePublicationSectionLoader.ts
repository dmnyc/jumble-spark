import {
  batchFetchPublicationSectionEvents,
  buildPublicationSectionRelayUrls,
  publicationRefKey,
  resolvePublicationEventIdToHex,
  type PublicationSectionRef
} from '@/lib/publication-section-fetch'
import { generateBech32IdFromATag } from '@/lib/tag'
import { isReplaceableEvent } from '@/lib/event'
import client from '@/services/client.service'
import { eventService } from '@/services/client.service'
import logger from '@/lib/logger'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const PUB_SEC_LOG = '[PublicationSection]'
function pubLog(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return
  if (data) logger.info(`${PUB_SEC_LOG} ${message}`, data)
  else logger.info(`${PUB_SEC_LOG} ${message}`)
}

export type SectionLoadStatus = 'idle' | 'loading' | 'loaded' | 'error'

export type PublicationSectionRow = {
  ref: PublicationSectionRef
  status: SectionLoadStatus
  event?: Event
}

function refKey(ref: PublicationSectionRef): string {
  return publicationRefKey(ref)
}

async function hydrateRefsFromIndexedDb(refs: PublicationSectionRef[]): Promise<Map<string, Event>> {
  const out = new Map<string, Event>()
  for (const ref of refs) {
    const key = refKey(ref)
    if (!key) continue
    try {
      if (ref.type === 'a' && ref.coordinate) {
        const ev = await indexedDb.getPublicationEvent(ref.coordinate)
        if (ev) out.set(key, ev)
      } else if (ref.type === 'e' && ref.eventId) {
        const hex = resolvePublicationEventIdToHex(ref.eventId)
        if (!hex) continue
        let ev = await indexedDb.getEventFromPublicationStore(hex)
        if (!ev && ref.kind != null && ref.pubkey && isReplaceableEvent(ref.kind)) {
          const rep = await indexedDb.getReplaceableEvent(ref.pubkey, ref.kind)
          if (rep && rep.id === hex) ev = rep
        }
        if (ev) out.set(key, ev)
      }
    } catch {
      /* ignore per-ref */
    }
  }
  return out
}

async function fetchSingleRefFallback(ref: PublicationSectionRef): Promise<Event | undefined> {
  try {
    if (ref.type === 'a' && ref.coordinate) {
      const bech32 = generateBech32IdFromATag(['a', ref.coordinate, ref.relay || '', ''])
      if (bech32) return await eventService.fetchEvent(bech32)
    }
    if (ref.type === 'e' && ref.eventId) {
      return await eventService.fetchEvent(ref.eventId)
    }
  } catch {
    /* ignore */
  }
  return undefined
}

/**
 * Lazy publication sections: debounced batched REQ (chunked `ids` + grouped `authors`/`kinds`/`#d`),
 * IndexedDB first, capped relay list. Call {@link requestKeys} from IntersectionObserver.
 */
export function usePublicationSectionLoader(indexEvent: Event, referencesData: PublicationSectionRef[]) {
  const orderedKeys = useMemo(() => {
    const keys: string[] = []
    for (const r of referencesData) {
      const k = refKey(r)
      if (k) keys.push(k)
    }
    return keys
  }, [referencesData])

  const [rows, setRows] = useState<Map<string, PublicationSectionRow>>(() => new Map())
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  useEffect(() => {
    const m = new Map<string, PublicationSectionRow>()
    for (const ref of referencesData) {
      const k = refKey(ref)
      if (!k) continue
      m.set(k, { ref, status: 'idle' })
    }
    setRows(m)
  }, [referencesData])

  const relayUrlsRef = useRef<string[]>([])
  const [relayReady, setRelayReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const urls = await buildPublicationSectionRelayUrls(indexEvent, referencesData)
      if (cancelled) return
      relayUrlsRef.current = urls
      setRelayReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [indexEvent, referencesData])

  const pendingRef = useRef(new Set<string>())
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushInFlightRef = useRef(false)

  const runFlush = useCallback(async () => {
    if (flushInFlightRef.current) return
    const keys = [...pendingRef.current]
    pendingRef.current.clear()
    if (keys.length === 0) return

    flushInFlightRef.current = true

    try {
      const snapshot = rowsRef.current
      const refsToLoad: PublicationSectionRef[] = []
      for (const k of keys) {
        const row = snapshot.get(k)
        if (!row) continue
        if (row.status === 'loaded' && row.event) continue
        refsToLoad.push(row.ref)
      }

      if (refsToLoad.length === 0) return

      pubLog('flush_start', {
        keys: refsToLoad.map((r) => refKey(r)),
        relayCount: relayUrlsRef.current.length
      })

      setRows((prev) => {
        const next = new Map(prev)
        for (const ref of refsToLoad) {
          const k = refKey(ref)
          const row = next.get(k)
          if (row) next.set(k, { ...row, status: 'loading' })
        }
        return next
      })

      const urls = relayUrlsRef.current
      const resolved = new Map<string, Event>()

      // Always hydrate from IDB — do not gate on relay URLs (they resolve async after first IO batch).
      const fromDb = await hydrateRefsFromIndexedDb(refsToLoad)
      for (const [k, ev] of fromDb) {
        resolved.set(k, ev)
        client.addEventToCache(ev)
      }

      let stillNeed = refsToLoad.filter((r) => !resolved.has(refKey(r)))
      pubLog('after_idb', {
        fromDb: fromDb.size,
        stillNeed: stillNeed.map((r) => ({ key: refKey(r), type: r.type }))
      })

      // No relay list yet: apply DB hits only, re-queue the rest (do not mark error).
      if (urls.length === 0 && stillNeed.length > 0) {
        for (const r of stillNeed) pendingRef.current.add(refKey(r))
        pubLog('defer_net_until_relays', { reQueued: stillNeed.length })
        setRows((prev) => {
          const next = new Map(prev)
          for (const ref of refsToLoad) {
            const k = refKey(ref)
            const row = next.get(k)
            if (!row) continue
            const ev = resolved.get(k)
            if (ev) next.set(k, { ...row, event: ev, status: 'loaded' })
            else next.set(k, { ...row, status: 'idle', event: undefined })
          }
          return next
        })
        return
      }

      if (urls.length > 0 && stillNeed.length > 0) {
        const fromNet = await batchFetchPublicationSectionEvents(stillNeed, urls)
        pubLog('after_batch_fetch', { fromNet: fromNet.size })
        for (const [k, ev] of fromNet) {
          resolved.set(k, ev)
          client.addEventToCache(ev)
          if (isReplaceableEvent(ev.kind)) void indexedDb.putReplaceableEvent(ev)
        }
      }

      const missing = refsToLoad.filter((r) => !resolved.has(refKey(r)))
      pubLog('before_fallback', {
        missing: missing.map((r) => refKey(r)),
        relayUrlsEmpty: urls.length === 0
      })
      await Promise.all(
        missing.map(async (ref) => {
          const k = refKey(ref)
          const ev = await fetchSingleRefFallback(ref)
          if (ev) {
            resolved.set(k, ev)
            client.addEventToCache(ev)
            if (isReplaceableEvent(ev.kind)) void indexedDb.putReplaceableEvent(ev)
          }
        })
      )

      const failed = refsToLoad.filter((r) => !resolved.has(refKey(r)))
      pubLog('flush_done', {
        loaded: refsToLoad.length - failed.length,
        failed: failed.map((r) => ({
          key: refKey(r),
          type: r.type,
          coordinate: r.coordinate,
          eventId: r.eventId
        }))
      })

      setRows((prev) => {
        const next = new Map(prev)
        for (const ref of refsToLoad) {
          const k = refKey(ref)
          const row = next.get(k)
          if (!row) continue
          const ev = resolved.get(k)
          if (ev) {
            next.set(k, { ...row, event: ev, status: 'loaded' })
          } else {
            next.set(k, { ...row, status: 'error', event: undefined })
          }
        }
        return next
      })
    } finally {
      flushInFlightRef.current = false
      // While a batch was in flight, debounced runFlush() calls may have returned early
      // (flush lock). Drain any keys that accumulated so scroll-triggered sections still load.
      if (pendingRef.current.size > 0) {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null
          void runFlush()
        }, 0)
      }
    }
  }, [])

  const requestKeys = useCallback(
    (keys: string[]) => {
      for (const k of keys) {
        if (k) pendingRef.current.add(k)
      }
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void runFlush()
      }, 56)
    },
    [runFlush]
  )

  useEffect(() => {
    if (!relayReady || orderedKeys.length === 0) return
    // Full list: scroll-IO may have fired before relays were ready; those keys were re-queued idle.
    requestKeys(orderedKeys)
  }, [relayReady, orderedKeys, requestKeys])

  const failedKeys = useMemo(
    () => [...rows.entries()].filter(([, v]) => v.status === 'error').map(([k]) => k),
    [rows]
  )

  const retryKeys = useCallback(
    (keys: string[]) => {
      setRows((prev) => {
        const next = new Map(prev)
        for (const k of keys) {
          const row = next.get(k)
          if (row) next.set(k, { ...row, status: 'idle', event: undefined })
        }
        return next
      })
      requestKeys(keys)
    },
    [requestKeys]
  )

  const referencesWithEvents = useMemo(() => {
    return orderedKeys.map((k) => {
      const row = rows.get(k)
      const ref = row?.ref ?? referencesData.find((r) => refKey(r) === k)!
      return {
        type: ref.type,
        coordinate: ref.coordinate,
        eventId: ref.eventId,
        kind: ref.kind,
        pubkey: ref.pubkey,
        identifier: ref.identifier,
        relay: ref.relay,
        event: row?.event,
        loadStatus: row?.status ?? 'idle'
      }
    })
  }, [orderedKeys, rows, referencesData])

  return {
    orderedKeys,
    rows,
    relayReady,
    requestKeys,
    retryKeys,
    failedKeys,
    referencesWithEvents
  }
}
