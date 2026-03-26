import { ExtendedKind } from '@/constants'
import { buildProfileReportRelayUrls } from '@/lib/profile-report-relay-urls'
import {
  profileAccordionGetCachedReports,
  profileAccordionRelayUrlsKey,
  profileAccordionSetReports
} from '@/lib/profile-accordion-session-cache'
import { queryService } from '@/services/client.service'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'

const REPORT_LIMIT = 50

/** NIP-56 reports (kind 1984) about `profilePubkey`, from viewer favorites + inboxes only. */
export function useProfileReports(
  profilePubkey: string | undefined,
  viewerPubkey: string | null | undefined
) {
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const favoriteRelaysRef = useRef(favoriteRelays)
  favoriteRelaysRef.current = favoriteRelays
  const blockedRelaysRef = useRef(blockedRelays)
  blockedRelaysRef.current = blockedRelays
  const favoriteRelaysKey = profileAccordionRelayUrlsKey(favoriteRelays ?? [])
  const blockedRelaysKey = profileAccordionRelayUrlsKey(blockedRelays)

  const [reports, setReports] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const fetchIdRef = useRef(0)

  const fetchReports = useCallback(async (force = false) => {
    const viewer = viewerPubkey?.trim()
    const myFetchId = (fetchIdRef.current += 1)

    if (!profilePubkey || !viewer) {
      if (myFetchId === fetchIdRef.current) {
        setReports([])
        setLoading(false)
      }
      return
    }

    if (!force) {
      const cached = profileAccordionGetCachedReports(profilePubkey, viewer)
      if (cached) {
        if (myFetchId !== fetchIdRef.current) return
        setReports(cached)
        setLoading(false)
        return
      }
    }

    const seed = profileAccordionGetCachedReports(profilePubkey, viewer)
    if (seed?.length && myFetchId === fetchIdRef.current) {
      setReports(seed)
    }

    if (myFetchId !== fetchIdRef.current) return
    if (!seed?.length) {
      setLoading(true)
    }

    try {
      const urls = await buildProfileReportRelayUrls({
        viewerPubkey: viewer,
        favoriteRelays: favoriteRelaysRef.current ?? [],
        blockedRelays: blockedRelaysRef.current
      })
      if (urls.length === 0) {
        if (myFetchId === fetchIdRef.current && !seed?.length) setReports([])
        return
      }

      const events = await queryService.fetchEvents(
        urls,
        [{ '#p': [profilePubkey], kinds: [ExtendedKind.REPORT], limit: REPORT_LIMIT }],
        { eoseTimeout: 2000, globalTimeout: 15000, firstRelayResultGraceMs: false }
      )

      if (myFetchId !== fetchIdRef.current) return

      const byId = new Map<string, Event>()
      for (const evt of seed ?? []) byId.set(evt.id, evt)
      const seen = new Set<string>(byId.keys())
      for (const evt of events) {
        if (seen.has(evt.id)) continue
        seen.add(evt.id)
        byId.set(evt.id, evt)
      }
      const merged = [...byId.values()].sort((a, b) => b.created_at - a.created_at)
      setReports(merged)
      profileAccordionSetReports(profilePubkey, viewer, merged)
    } catch {
      if (myFetchId !== fetchIdRef.current) return
      if (!seed?.length) setReports([])
    } finally {
      if (myFetchId === fetchIdRef.current) setLoading(false)
    }
  }, [profilePubkey, viewerPubkey, favoriteRelaysKey, blockedRelaysKey])

  const refresh = useCallback(() => {
    void fetchReports(true)
  }, [profilePubkey, viewerPubkey, fetchReports])

  useEffect(() => {
    void fetchReports(false)
  }, [fetchReports])

  return { reports, loading, refresh }
}
