import NoteList from '@/components/NoteList'
import { ExtendedKind, PROFILE_FETCH_RELAY_URLS } from '@/constants'
import {
  getRelayUrlFromRelayReviewEvent,
  getStarsFromRelayReviewEvent
} from '@/lib/event-metadata'
import { buildExploreProfileAndUserRelayList } from '@/lib/relay-list-builder'
import { useNostr } from '@/providers/NostrProvider'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'

export default function ExploreRelayReviews() {
  const { pubkey } = useNostr()
  const [relayUrls, setRelayUrls] = useState<string[]>(() => [...PROFILE_FETCH_RELAY_URLS])

  useEffect(() => {
    let cancelled = false
    buildExploreProfileAndUserRelayList(pubkey ?? null).then((urls) => {
      if (!cancelled) setRelayUrls(urls)
    })
    return () => {
      cancelled = true
    }
  }, [pubkey])

  const subRequests = useMemo(() => [{ urls: relayUrls, filter: {} }], [relayUrls])

  const extraShouldHideEvent = useCallback((evt: Event) => {
    if (evt.kind !== ExtendedKind.RELAY_REVIEW) return false
    if (!getRelayUrlFromRelayReviewEvent(evt)) return true
    return !getStarsFromRelayReviewEvent(evt)
  }, [])

  return (
    <div className="min-w-0 pt-1">
      <NoteList
        showKinds={[ExtendedKind.RELAY_REVIEW]}
        subRequests={subRequests}
        showKind1OPs={false}
        showKind1Replies={false}
        showKind1111={false}
        extraShouldHideEvent={extraShouldHideEvent}
      />
    </div>
  )
}
