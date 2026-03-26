import { ExtendedKind } from '@/constants'
import { buildProfileReportRelayUrls } from '@/lib/profile-report-relay-urls'
import {
  profileAccordionGetCachedReports,
  profileAccordionInvalidate,
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

    if (myFetchId !== fetchIdRef.current) return
    setLoading(true)

    try {
      const urls = await buildProfileReportRelayUrls({
        viewerPubkey: viewer,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })
      if (urls.length === 0) {
        if (myFetchId === fetchIdRef.current) setReports([])
        return
      }

      const events = await queryService.fetchEvents(
        urls,
        [{ '#p': [profilePubkey], kinds: [ExtendedKind.REPORT], limit: REPORT_LIMIT }],
        { eoseTimeout: 2000, globalTimeout: 15000, firstRelayResultGraceMs: false }
      )

      if (myFetchId !== fetchIdRef.current) return

      const seen = new Set<string>()
      const deduped: Event[] = []
      for (const evt of events) {
        if (seen.has(evt.id)) continue
        seen.add(evt.id)
        deduped.push(evt)
      }
      deduped.sort((a, b) => b.created_at - a.created_at)
      setReports(deduped)
      profileAccordionSetReports(profilePubkey, viewer, deduped)
    } catch {
      if (myFetchId !== fetchIdRef.current) return
      setReports([])
    } finally {
      if (myFetchId === fetchIdRef.current) setLoading(false)
    }
  }, [profilePubkey, viewerPubkey, favoriteRelays, blockedRelays])

  const refresh = useCallback(() => {
    const v = viewerPubkey?.trim()
    if (profilePubkey && v) profileAccordionInvalidate(profilePubkey, 'reports')
    void fetchReports(true)
  }, [profilePubkey, viewerPubkey, fetchReports])

  useEffect(() => {
    void fetchReports(false)
  }, [fetchReports])

  return { reports, loading, refresh }
}
