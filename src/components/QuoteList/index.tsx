import { ExtendedKind, SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'
import { useStuff } from '@/hooks/useStuff'
import {
  getEventAuthorPubkey,
  getReplaceableCoordinateFromEvent,
  isProtectedEvent,
  isReplaceableEvent
} from '@/lib/event'
import { getDefaultRelayUrls, mergeRelayUrls } from '@/lib/relay'
import { useUserTrust } from '@/providers/UserTrustProvider'
import client from '@/services/client.service'
import { TFeedSubRequest } from '@/types'
import { Event, Filter, kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import NoteList from '../NoteList'

export default function QuoteList({
  stuff,
  onCountChange
}: {
  stuff: Event | string
  onCountChange?: (count: number) => void
}) {
  const { event, externalContent } = useStuff(stuff)
  const { getMinTrustScore } = useUserTrust()
  const trustScoreThreshold = useMemo(
    () => getMinTrustScore(SPECIAL_TRUST_SCORE_FILTER_ID.INTERACTIONS),
    [getMinTrustScore]
  )
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])

  useEffect(() => {
    let cancelled = false
    async function init() {
      let relayUrls = getDefaultRelayUrls().slice(0, 5)
      const filters: Filter[] = []
      if (event) {
        const relayList = await client.fetchRelayList(getEventAuthorPubkey(event))
        const seenOn = client.getSeenEventRelayUrls(event.id)
        const baseRelays = mergeRelayUrls(5, relayList.read, getDefaultRelayUrls())
        relayUrls = isProtectedEvent(event)
          ? mergeRelayUrls(baseRelays, seenOn)
          : mergeRelayUrls(5, baseRelays, seenOn)

        const isReplaceable = isReplaceableEvent(event.kind)
        const key = isReplaceable ? getReplaceableCoordinateFromEvent(event) : event.id
        filters.push({
          '#q': [key],
          kinds: [
            kinds.ShortTextNote,
            kinds.LongFormArticle,
            ExtendedKind.COMMENT,
            ExtendedKind.POLL
          ]
        })
        if (isReplaceable) {
          filters.push({
            '#a': [key],
            kinds: [kinds.Highlights]
          })
        } else {
          filters.push({
            '#e': [key],
            kinds: [kinds.Highlights]
          })
        }
      }
      if (externalContent) {
        filters.push({
          '#r': [externalContent],
          kinds: [kinds.Highlights]
        })
      }
      if (cancelled) return
      setSubRequests(filters.map((filter) => ({ urls: relayUrls, filter })))
    }

    init()
    return () => {
      cancelled = true
    }
  }, [event, externalContent])

  return (
    <NoteList
      subRequests={subRequests}
      trustScoreThreshold={trustScoreThreshold}
      onFilteredCountChange={onCountChange}
    />
  )
}
