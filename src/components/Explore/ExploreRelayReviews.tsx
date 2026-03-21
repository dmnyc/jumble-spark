import NoteList from '@/components/NoteList'
import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import {
  getRelayUrlFromRelayReviewEvent,
  getStarsFromRelayReviewEvent
} from '@/lib/event-metadata'
import { Event } from 'nostr-tools'
import { useCallback } from 'react'

export default function ExploreRelayReviews() {
  const extraShouldHideEvent = useCallback((evt: Event) => {
    if (evt.kind !== ExtendedKind.RELAY_REVIEW) return false
    if (!getRelayUrlFromRelayReviewEvent(evt)) return true
    return !getStarsFromRelayReviewEvent(evt)
  }, [])

  return (
    <div className="min-w-0 pt-1">
      <NoteList
        showKinds={[ExtendedKind.RELAY_REVIEW]}
        subRequests={[{ urls: [...FAST_READ_RELAY_URLS], filter: {} }]}
        showKind1OPs={false}
        showKind1Replies={false}
        showKind1111={false}
        extraShouldHideEvent={extraShouldHideEvent}
      />
    </div>
  )
}
