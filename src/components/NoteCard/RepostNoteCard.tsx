import { ExtendedKind } from '@/constants'
import { isMentioningMutedUsers } from '@/lib/event'
import { generateBech32IdFromATag, getFirstHexEventIdFromETags, tagNameEquals } from '@/lib/tag'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import client from '@/services/client.service'
import { eventService } from '@/services/client.service'
import { Event, kinds, nip19, verifyEvent } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import MainNoteCard from './MainNoteCard'

export default function RepostNoteCard({
  event,
  className,
  filterMutedNotes = true,
  pinned = false
}: {
  event: Event
  className?: string
  filterMutedNotes?: boolean
  pinned?: boolean
}) {
  const { mutePubkeySet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const [targetEvent, setTargetEvent] = useState<Event | null>(null)
  const shouldHide = useMemo(() => {
    if (!targetEvent) return true
    if (filterMutedNotes && mutePubkeySet.has(targetEvent.pubkey)) {
      return true
    }
    if (hideContentMentioningMutedUsers && isMentioningMutedUsers(targetEvent, mutePubkeySet)) {
      return true
    }
    return false
  }, [targetEvent, filterMutedNotes, hideContentMentioningMutedUsers, mutePubkeySet])
  useEffect(() => {
    const fetch = async () => {
      try {
        const eventFromContent = event.content ? (JSON.parse(event.content) as Event) : null
        if (eventFromContent && verifyEvent(eventFromContent)) {
          if (eventFromContent.kind === kinds.Repost || eventFromContent.kind === ExtendedKind.GENERIC_REPOST) {
            return
          }
          client.addEventToCache(eventFromContent)
          const targetSeenOn = client.getSeenEventRelays(eventFromContent.id)
          if (targetSeenOn.length === 0) {
            const seenOn = client.getSeenEventRelays(event.id)
            seenOn.forEach((relay) => {
              client.trackEventSeenOn(eventFromContent.id, relay)
            })
          }
          setTargetEvent(eventFromContent)
          return
        }

        const hex = getFirstHexEventIdFromETags(event.tags)
        if (hex) {
          const row =
            event.tags.find((t) => (t[0] === 'e' || t[0] === 'E') && t[1] === hex) ?? []
          const [, id, relay, , pubkey] = row
          const targetEventId = nip19.neventEncode({
            id,
            relays: relay ? [relay] : [],
            author: pubkey
          })
          const targetEvent = await eventService.fetchEvent(targetEventId)
          if (targetEvent) {
            setTargetEvent(targetEvent)
          }
          return
        }

        if (event.kind === ExtendedKind.GENERIC_REPOST) {
          const aRow = event.tags.find(tagNameEquals('a')) ?? event.tags.find(tagNameEquals('A'))
          const naddr = aRow ? generateBech32IdFromATag(aRow) : undefined
          if (naddr) {
            const ev = await eventService.fetchEvent(naddr)
            if (ev) {
              setTargetEvent(ev)
            }
          }
        }
      } catch {
        // ignore
      }
    }
    fetch()
  }, [event])

  if (!targetEvent || shouldHide) return null

  return <MainNoteCard className={className} reposter={event.pubkey} event={targetEvent} pinned={pinned} />
}
