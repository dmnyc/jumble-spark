import { getPubkeysFromPTags } from '@/lib/tag'
import { replaceableEventService } from '@/services/client.service'
import { kinds } from 'nostr-tools'
import { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'

export function useFetchFollowings(pubkey?: string | null) {
  const [followListEvent, setFollowListEvent] = useState<Event | null>(null)
  const [followings, setFollowings] = useState<string[]>([])
  const [isFetching, setIsFetching] = useState(true)

  useEffect(() => {
    const init = async () => {
      try {
        setIsFetching(true)
        if (!pubkey) return

        const event = await replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Contacts) ?? null
        if (!event) return

        setFollowListEvent(event)
        setFollowings(getPubkeysFromPTags(event.tags))
      } finally {
        setIsFetching(false)
      }
    }

    init()
  }, [pubkey])

  return { followings, followListEvent, isFetching }
}
