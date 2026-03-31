import logger from '@/lib/logger'
import {
  batchFetchPublicationSectionEvents,
  buildPublicationSectionRelayUrls,
  parsePublicationATagCoordinate,
  publicationRefKey,
  resolvePublicationEventIdToHex,
  type PublicationSectionRef
} from '@/lib/publication-section-fetch'
import { eventService, queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error'

type Row = PublicationSectionRef & {
  key: string
  event?: Event
  status: LoadStatus
}

type CachedState = {
  loaded: Map<string, Event>
  failed: Set<string>
}

const indexCache = new Map<string, CachedState>()
const SINGLE_REF_TIMEOUT_MS = 6_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function signatureOfRefs(refs: PublicationSectionRef[]): string {
  return refs.map((r) => publicationRefKey(r)).join('|')
}

export function usePublicationSectionLoader(indexEvent: Event, refs: PublicationSectionRef[]) {
  const indexId = indexEvent.id
  const refsSignature = useMemo(() => signatureOfRefs(refs), [refs])
  const [relayUrls, setRelayUrls] = useState<string[]>([])
  const [fallbackRelayUrls, setFallbackRelayUrls] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const inflightKeysRef = useRef<Set<string>>(new Set())
  const autoLoadedSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    const cached = indexCache.get(indexId) ?? { loaded: new Map(), failed: new Set() }
    const next: Row[] = []
    for (const ref of refs) {
      const key = publicationRefKey(ref)
      if (!key) continue
      const cachedEvent = cached.loaded.get(key)
      if (cachedEvent) {
        next.push({ ...ref, key, event: cachedEvent, status: 'loaded' })
        continue
      }
      if (cached.failed.has(key)) {
        next.push({ ...ref, key, status: 'error' })
        continue
      }
      next.push({ ...ref, key, status: 'idle' })
    }
    setRows(next)
  }, [indexId, refsSignature, refs])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const primary = await buildPublicationSectionRelayUrls(indexEvent, refs, 30, false)
      if (cancelled) return
      if (import.meta.env.DEV) {
        logger.info('[PublicationSection] relay_urls_primary', {
          indexId,
          count: primary.length,
          relays: primary
        })
      }
      setRelayUrls(primary)

      const fallback = await buildPublicationSectionRelayUrls(indexEvent, refs, 60, true)
      if (cancelled) return
      if (import.meta.env.DEV) {
        const uniqueExtra = fallback.filter((u) => !primary.includes(u))
        logger.info('[PublicationSection] relay_urls_searchable_fallback', {
          indexId,
          count: fallback.length,
          extraCount: uniqueExtra.length,
          relays: fallback
        })
      }
      setFallbackRelayUrls(fallback)
    })().catch((err) => {
      if (import.meta.env.DEV) {
        logger.warn('[PublicationSection] relay_build_failed', {
          indexId,
          message: err instanceof Error ? err.message : String(err)
        })
      }
      if (!cancelled) {
        setRelayUrls([])
        setFallbackRelayUrls([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [indexId, refsSignature, indexEvent, refs])

  const applyLoadedAndFailed = useCallback(
    (loaded: Map<string, Event>, failedKeys: string[]) => {
      const cached = indexCache.get(indexId) ?? { loaded: new Map(), failed: new Set() }
      for (const [k, ev] of loaded) {
        cached.loaded.set(k, ev)
        cached.failed.delete(k)
      }
      for (const k of failedKeys) {
        if (!loaded.has(k)) cached.failed.add(k)
      }
      indexCache.set(indexId, cached)

      setRows((prev) =>
        prev.map((row) => {
          const ev = loaded.get(row.key)
          if (ev) return { ...row, event: ev, status: 'loaded' as const }
          if (failedKeys.includes(row.key)) return { ...row, status: 'error' as const }
          if (inflightKeysRef.current.has(row.key)) return { ...row, status: 'loading' as const }
          return row
        })
      )
    },
    [indexId]
  )

  const runFetch = useCallback(
    async (keys: string[]) => {
      const selectedRows = rows.filter((r) => keys.includes(r.key))
      if (selectedRows.length === 0) return
      if (import.meta.env.DEV) {
        logger.info('[PublicationSection] run_fetch_start', {
          indexId,
          keyCount: selectedRows.length,
          keys: selectedRows.map((r) => r.key),
          relayCount: relayUrls.length
        })
      }

      const byDb = new Map<string, Event>()
      const stillNeed: Row[] = []

      await Promise.all(
        selectedRows.map(async (row) => {
          try {
            let ev: Event | undefined
            if (row.type === 'e' && row.eventId) {
              const hex = resolvePublicationEventIdToHex(row.eventId)
              if (hex) ev = await indexedDb.getEventFromPublicationStore(hex)
            } else if (row.coordinate) {
              ev = await indexedDb.getPublicationEvent(row.coordinate)
            }
            if (ev) byDb.set(row.key, ev)
            else stillNeed.push(row)
          } catch {
            stillNeed.push(row)
          }
        })
      )

      if (import.meta.env.DEV) {
        logger.info('[PublicationSection] after_idb', {
          fromDb: byDb.size,
          stillNeed: stillNeed.map((r) => r.key)
        })
      }

      let fromNet = new Map<string, Event>()
      if (stillNeed.length > 0 && relayUrls.length > 0) {
        fromNet = await batchFetchPublicationSectionEvents(stillNeed, relayUrls)
        if (import.meta.env.DEV) {
          logger.info('[PublicationSection] after_batch_fetch', { fromNet: fromNet.size })
        }
      }

      const merged = new Map<string, Event>([...byDb, ...fromNet])
      let unresolved = stillNeed.filter((r) => !merged.has(r.key))

      // Second pass: unresolved refs on broader searchable relay set.
      if (unresolved.length > 0 && fallbackRelayUrls.length > 0) {
        const fallbackOnly = fallbackRelayUrls.filter((u) => !relayUrls.includes(u))
        const relaysForFallback = fallbackOnly.length > 0 ? fallbackRelayUrls : []
        if (relaysForFallback.length > 0) {
          if (import.meta.env.DEV) {
            logger.info('[PublicationSection] searchable_fallback_start', {
              unresolved: unresolved.map((r) => r.key),
              relayCount: relaysForFallback.length
            })
          }
          const fromSearchFallback = await batchFetchPublicationSectionEvents(
            unresolved,
            relaysForFallback
          )
          for (const [k, ev] of fromSearchFallback) merged.set(k, ev)
          unresolved = unresolved.filter((r) => !merged.has(r.key))
          if (import.meta.env.DEV) {
            logger.info('[PublicationSection] searchable_fallback_done', {
              fromSearchFallback: fromSearchFallback.size,
              stillNeed: unresolved.map((r) => r.key)
            })
          }
        }
      }
      const bySingle = new Map<string, Event>()

      await Promise.all(
        unresolved.map(async (row) => {
          try {
            if (row.type === 'e' && row.eventId) {
              const ev = await withTimeout(
                eventService.fetchEvent(row.eventId),
                SINGLE_REF_TIMEOUT_MS
              )
              if (ev) bySingle.set(row.key, ev)
              return
            }
            if (row.coordinate) {
              const parsed = parsePublicationATagCoordinate(row.coordinate)
              if (!parsed) return
              const relaysToTry = row.relay ? [row.relay] : relayUrls
              const ev = await withTimeout(
                queryService
                  .fetchEvents(
                    relaysToTry,
                    {
                      authors: [parsed.pubkey],
                      kinds: [parsed.kind],
                      '#d': [parsed.identifier],
                      limit: 1
                    },
                    {
                      globalTimeout: 6_000,
                      eoseTimeout: 1_500
                    }
                  )
                  .then((arr) => arr[0]),
                SINGLE_REF_TIMEOUT_MS
              )
              if (ev) bySingle.set(row.key, ev)
            }
          } catch {
            // unresolved single-ref fallback
          }
        })
      )

      for (const [k, ev] of bySingle) merged.set(k, ev)

      const failed = selectedRows
        .map((r) => r.key)
        .filter((k) => !merged.has(k))

      if (import.meta.env.DEV) {
        logger.info('[PublicationSection] run_fetch_done', {
          indexId,
          loadedCount: merged.size,
          failedCount: failed.length,
          failedKeys: failed
        })
      }

      applyLoadedAndFailed(merged, failed)
    },
    [applyLoadedAndFailed, fallbackRelayUrls, relayUrls, rows]
  )

  const requestKeys = useCallback(
    (keys: string[]) => {
      const unique = [...new Set(keys.filter(Boolean))]
      if (unique.length === 0) return
      const eligible = rows.filter((r) => unique.includes(r.key) && r.status !== 'loaded' && r.status !== 'loading')
      if (eligible.length === 0) return

      const keysToLoad = eligible.map((r) => r.key)
      for (const k of keysToLoad) inflightKeysRef.current.add(k)
      setRows((prev) => prev.map((r) => (keysToLoad.includes(r.key) ? { ...r, status: 'loading' } : r)))

      void runFetch(keysToLoad).finally(() => {
        for (const k of keysToLoad) inflightKeysRef.current.delete(k)
      })
    },
    [rows, runFetch]
  )

  const retryKeys = useCallback(
    (keys: string[]) => {
      const unique = [...new Set(keys.filter(Boolean))]
      if (unique.length === 0) return
      const cached = indexCache.get(indexId)
      if (cached) {
        for (const key of unique) cached.failed.delete(key)
      }
      setRows((prev) =>
        prev.map((r) => (unique.includes(r.key) && r.status !== 'loaded' ? { ...r, status: 'idle' } : r))
      )
      requestKeys(unique)
    },
    [indexId, requestKeys]
  )

  useEffect(() => {
    if (relayUrls.length === 0) return
    const sig = `${indexId}:${refsSignature}`
    if (autoLoadedSignatureRef.current === sig) return
    autoLoadedSignatureRef.current = sig
    const idleKeys = rows.filter((r) => r.status === 'idle').map((r) => r.key)
    if (idleKeys.length > 0) {
      if (import.meta.env.DEV) {
        logger.info('[PublicationSection] flush_start', { keys: idleKeys, relayCount: relayUrls.length })
      }
      requestKeys(idleKeys)
    }
  }, [indexId, refsSignature, relayUrls, rows, requestKeys])

  const referencesWithEvents = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        loadStatus: row.status
      })),
    [rows]
  )

  const failedKeys = useMemo(
    () =>
      rows
        .filter((r) => r.status === 'error')
        .map((r) => r.key),
    [rows]
  )

  return {
    requestKeys,
    retryKeys,
    failedKeys,
    referencesWithEvents
  }
}
