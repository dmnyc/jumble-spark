import { FAST_READ_RELAY_URLS, DEFAULT_FAVORITE_RELAYS } from '@/constants'
import { createFavoriteRelaysDraftEvent, createBlockedRelaysDraftEvent, createRelaySetDraftEvent } from '@/lib/draft-event'
import { getReplaceableEventIdentifier } from '@/lib/event'
import { getRelaySetFromEvent } from '@/lib/event-metadata'
import { randomString } from '@/lib/random'
import { isWebsocketUrl, normalizeUrl } from '@/lib/url'
import { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import storage from '@/services/local-storage.service'
import { TRelaySet } from '@/types'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { FavoriteRelaysContext } from './favorite-relays-context'
import { useNostr } from './NostrProvider'

export { useFavoriteRelays } from './favorite-relays-context'
export type { TFavoriteRelaysContext } from './favorite-relays-context'

export function FavoriteRelaysProvider({ children }: { children: React.ReactNode }) {
  const { favoriteRelaysEvent, blockedRelaysEvent, updateFavoriteRelaysEvent, updateBlockedRelaysEvent, pubkey, relayList, publish } = useNostr()
  const [favoriteRelays, setFavoriteRelays] = useState<string[]>([])
  const [blockedRelays, setBlockedRelays] = useState<string[]>([])
  const [relaySetEvents, setRelaySetEvents] = useState<Event[]>([])
  const [relaySets, setRelaySets] = useState<TRelaySet[]>([])

  useEffect(() => {
    if (!favoriteRelaysEvent) {
      // For anonymous users (no login), only use relays from FAST_READ_RELAY_URLS
      // Don't load potentially untrusted relays from local storage
      const favoriteRelays: string[] = pubkey ? DEFAULT_FAVORITE_RELAYS : FAST_READ_RELAY_URLS.slice()
      
      if (pubkey) {
        // Only add stored relay sets if user is logged in
        const storedRelaySets = storage.getRelaySets()
        storedRelaySets.forEach(({ relayUrls }) => {
          relayUrls.forEach((url) => {
            if (!favoriteRelays.includes(url)) {
              favoriteRelays.push(url)
            }
          })
        })
      }

      setFavoriteRelays(favoriteRelays)
      setRelaySetEvents([])
      return
    }

    const init = async () => {
      const relays: string[] = []
      const relaySetIds: string[] = []

      favoriteRelaysEvent.tags.forEach(([tagName, tagValue]) => {
        if (!tagValue) return

        if (tagName === 'relay') {
          const normalizedUrl = normalizeUrl(tagValue)
          if (normalizedUrl && !relays.includes(normalizedUrl)) {
            relays.push(normalizedUrl)
          }
        } else if (tagName === 'a') {
          const [kind, author, relaySetId] = tagValue.split(':')
          if (kind !== kinds.Relaysets.toString()) return
          if (!pubkey || author !== pubkey) return // TODO: support others relay sets
          if (!relaySetId) return

          if (!relaySetIds.includes(relaySetId)) {
            relaySetIds.push(relaySetId)
          }
        }
      })

      // Keep all favorites in state - don't filter blocked relays here
      // Blocked relays are filtered at the relay selection service level
      setFavoriteRelays(relays)

      if (!pubkey || !relaySetIds.length) {
        setRelaySets([])
        return
      }
      const storedRelaySetEvents = await Promise.all(
        relaySetIds.map((id) => indexedDb.getReplaceableEvent(pubkey, kinds.Relaysets, id))
      )
      setRelaySetEvents(storedRelaySetEvents.filter(Boolean) as Event[])

      const normalizedRelays = [
        ...(relayList?.write ?? []).map(url => normalizeUrl(url) || url),
        ...FAST_READ_RELAY_URLS.map(url => normalizeUrl(url) || url)
      ]
      const newRelaySetEvents = await queryService.fetchEvents(
        Array.from(new Set(normalizedRelays)).slice(0, 5),
        {
          kinds: [kinds.Relaysets],
          authors: [pubkey],
          '#d': relaySetIds
        }
      )
      const relaySetEventMap = new Map<string, Event>()
      newRelaySetEvents.forEach((event) => {
        const d = getReplaceableEventIdentifier(event)
        if (!d) return

        const old = relaySetEventMap.get(d)
        if (!old || old.created_at < event.created_at) {
          relaySetEventMap.set(d, event)
        }
      })
      const uniqueNewRelaySetEvents = relaySetIds
        .map((id, index) => {
          const event = relaySetEventMap.get(id)
          if (event) {
            return event
          }
          return storedRelaySetEvents[index] || null
        })
        .filter(Boolean) as Event[]
      setRelaySetEvents(uniqueNewRelaySetEvents)
      await Promise.all(
        uniqueNewRelaySetEvents.map((event) => {
          return indexedDb.putReplaceableEvent(event)
        })
      )
    }
    init()
  }, [favoriteRelaysEvent, pubkey])

  useEffect(() => {
    if (!blockedRelaysEvent) {
      setBlockedRelays([])
      return
    }

    const relays: string[] = []
    blockedRelaysEvent.tags.forEach(([tagName, tagValue]) => {
      if (tagName === 'relay' && tagValue) {
        const normalizedUrl = normalizeUrl(tagValue)
        if (normalizedUrl && !relays.includes(normalizedUrl)) {
          relays.push(normalizedUrl)
        }
      }
    })
    setBlockedRelays(relays)
  }, [blockedRelaysEvent])

  useEffect(() => {
    setRelaySets(
      relaySetEvents.map((evt) => getRelaySetFromEvent(evt, blockedRelays)).filter(Boolean) as TRelaySet[]
    )
  }, [relaySetEvents, blockedRelays])

  const addFavoriteRelays = async (relayUrls: string[]) => {
    const normalizedUrls = relayUrls
      .map((relayUrl) => normalizeUrl(relayUrl))
      .filter((url) => !!url && !favoriteRelays.includes(url))
    if (!normalizedUrls.length) return

    const draftEvent = createFavoriteRelaysDraftEvent(
      [...favoriteRelays, ...normalizedUrls],
      relaySetEvents
    )
    const newFavoriteRelaysEvent = await publish(draftEvent)
    updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
  }

  const deleteFavoriteRelays = async (relayUrls: string[]) => {
    const normalizedUrls = relayUrls
      .map((relayUrl) => normalizeUrl(relayUrl))
      .filter((url) => !!url && favoriteRelays.includes(url))
    if (!normalizedUrls.length) return

    const draftEvent = createFavoriteRelaysDraftEvent(
      favoriteRelays.filter((url) => !normalizedUrls.includes(url)),
      relaySetEvents
    )
    const newFavoriteRelaysEvent = await publish(draftEvent)
    updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
  }

  const createRelaySet = async (relaySetName: string, relayUrls: string[] = []) => {
    const normalizedUrls = relayUrls
      .map((url) => normalizeUrl(url))
      .filter((url) => isWebsocketUrl(url))
    const id = randomString()
    const relaySetDraftEvent = createRelaySetDraftEvent({
      id,
      name: relaySetName,
      relayUrls: normalizedUrls
    })
    const newRelaySetEvent = await publish(relaySetDraftEvent)
    await indexedDb.putReplaceableEvent(newRelaySetEvent)

    const favoriteRelaysDraftEvent = createFavoriteRelaysDraftEvent(favoriteRelays, [
      ...relaySetEvents,
      newRelaySetEvent
    ])
    const newFavoriteRelaysEvent = await publish(favoriteRelaysDraftEvent)
    updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
  }

  const addRelaySets = async (newRelaySetEvents: Event[]) => {
    const favoriteRelaysDraftEvent = createFavoriteRelaysDraftEvent(favoriteRelays, [
      ...relaySetEvents,
      ...newRelaySetEvents
    ])
    const newFavoriteRelaysEvent = await publish(favoriteRelaysDraftEvent)
    updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
  }

  const deleteRelaySet = async (id: string) => {
    const newRelaySetEvents = relaySetEvents.filter((event) => {
      return getReplaceableEventIdentifier(event) !== id
    })
    if (newRelaySetEvents.length === relaySetEvents.length) return

    const draftEvent = createFavoriteRelaysDraftEvent(favoriteRelays, newRelaySetEvents)
    const newFavoriteRelaysEvent = await publish(draftEvent)
    updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
  }

  const updateRelaySet = async (newSet: TRelaySet) => {
    const draftEvent = createRelaySetDraftEvent(newSet)
    const newRelaySetEvent = await publish(draftEvent)
    await indexedDb.putReplaceableEvent(newRelaySetEvent)

    setRelaySetEvents((prev) => {
      return prev.map((event) => {
        if (getReplaceableEventIdentifier(event) === newSet.id) {
          return newRelaySetEvent
        }
        return event
      })
    })
  }

  const reorderFavoriteRelays = async (reorderedRelays: string[]) => {
    setFavoriteRelays(reorderedRelays)
    const draftEvent = createFavoriteRelaysDraftEvent(reorderedRelays, relaySetEvents)
    const newFavoriteRelaysEvent = await publish(draftEvent)
    updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
  }

  const addBlockedRelays = async (relayUrls: string[]) => {
    const normalizedUrls = relayUrls
      .map((relayUrl) => normalizeUrl(relayUrl))
      .filter((url) => !!url && !blockedRelays.includes(url))
    if (!normalizedUrls.length) return
    const newBlockedRelays = [...blockedRelays, ...normalizedUrls]
    setBlockedRelays(newBlockedRelays)
    const draftEvent = createBlockedRelaysDraftEvent(newBlockedRelays)
    const newBlockedRelaysEvent = await publish(draftEvent)
    updateBlockedRelaysEvent(newBlockedRelaysEvent)
  }

  const deleteBlockedRelays = async (relayUrls: string[]) => {
    const normalizedUrls = relayUrls.map((relayUrl) => normalizeUrl(relayUrl)).filter(Boolean)
    const newBlockedRelays = blockedRelays.filter((relay) => !normalizedUrls.includes(relay))
    setBlockedRelays(newBlockedRelays)
    const draftEvent = createBlockedRelaysDraftEvent(newBlockedRelays)
    const newBlockedRelaysEvent = await publish(draftEvent)
    updateBlockedRelaysEvent(newBlockedRelaysEvent)
  }

  const reorderRelaySets = async (reorderedSets: TRelaySet[]) => {
    setRelaySets(reorderedSets)
    const draftEvent = createFavoriteRelaysDraftEvent(
      favoriteRelays,
      reorderedSets.map((set) => set.aTag)
    )
    const newFavoriteRelaysEvent = await publish(draftEvent)
    updateFavoriteRelaysEvent(newFavoriteRelaysEvent)
  }

  return (
    <FavoriteRelaysContext.Provider
      value={{
        favoriteRelays,
        addFavoriteRelays,
        deleteFavoriteRelays,
        reorderFavoriteRelays,
        blockedRelays,
        addBlockedRelays,
        deleteBlockedRelays,
        relaySets,
        createRelaySet,
        addRelaySets,
        deleteRelaySet,
        updateRelaySet,
        reorderRelaySets
      }}
    >
      {children}
    </FavoriteRelaysContext.Provider>
  )
}
