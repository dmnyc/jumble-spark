import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { createMuteListDraftEvent } from '@/lib/draft-event'
import {
  dedupePTagsAppendPubkey,
  fetchLatestReplaceableListEvent,
  removePubkeyFromPTags
} from '@/lib/replaceable-list-latest'
import { getPubkeysFromPTags } from '@/lib/tag'
import { MuteListContext } from '@/contexts/mute-list-context'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { kinds } from 'nostr-tools'
import dayjs from 'dayjs'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { useNostr } from './NostrProvider'
import { useFavoriteRelays } from './FavoriteRelaysProvider'
import logger from '@/lib/logger'

export function MuteListProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const {
    pubkey: accountPubkey,
    muteListEvent,
    publish,
    updateMuteListEvent,
    nip04Decrypt,
    nip04Encrypt
  } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [tags, setTags] = useState<string[][]>([])
  const [privateTags, setPrivateTags] = useState<string[][]>([])
  const publicMutePubkeySet = useMemo(() => new Set(getPubkeysFromPTags(tags)), [tags])
  const privateMutePubkeySet = useMemo(
    () => new Set(getPubkeysFromPTags(privateTags)),
    [privateTags]
  )
  const mutePubkeySet = useMemo(() => {
    return new Set([...Array.from(privateMutePubkeySet), ...Array.from(publicMutePubkeySet)])
  }, [publicMutePubkeySet, privateMutePubkeySet])
  const [changing, setChanging] = useState(false)

  const getPrivateTags = async (muteListEvent: Event) => {
    if (!muteListEvent.content) return []

    const storedDecryptedTags = await indexedDb.getMuteDecryptedTags(muteListEvent.id)

    if (storedDecryptedTags) {
      return storedDecryptedTags
    } else {
      try {
        const plainText = await nip04Decrypt(muteListEvent.pubkey, muteListEvent.content)
        const privateTags = z.array(z.array(z.string())).parse(JSON.parse(plainText))
        await indexedDb.putMuteDecryptedTags(muteListEvent.id, privateTags)
        return privateTags
      } catch (error) {
        logger.error('Failed to decrypt mute list content', { error, eventId: muteListEvent.id })
        return []
      }
    }
  }

  useEffect(() => {
    const updateMuteTags = async () => {
      if (!muteListEvent) {
        setTags([])
        setPrivateTags([])
        return
      }

      const privateTags = await getPrivateTags(muteListEvent).catch(() => {
        return []
      })
      setPrivateTags(privateTags)
      setTags(muteListEvent.tags)
    }
    updateMuteTags()
  }, [muteListEvent])

  const getMutePubkeys = () => {
    return Array.from(mutePubkeySet)
  }

  const getMuteType = useCallback(
    (pubkey: string): 'public' | 'private' | null => {
      if (publicMutePubkeySet.has(pubkey)) return 'public'
      if (privateMutePubkeySet.has(pubkey)) return 'private'
      return null
    },
    [publicMutePubkeySet, privateMutePubkeySet]
  )

  const loadLatestMuteListEvent = useCallback(async (): Promise<Event | null> => {
    if (!accountPubkey) return null
    const relays = await buildAccountListRelayUrlsForMerge({
      accountPubkey,
      favoriteRelays: favoriteRelays ?? [],
      blockedRelays
    })
    const fromNetwork = await fetchLatestReplaceableListEvent(accountPubkey, kinds.Mutelist, relays)
    if (fromNetwork) return fromNetwork
    return (await client.fetchMuteListEvent(accountPubkey)) ?? null
  }, [accountPubkey, favoriteRelays, blockedRelays])

  const publishNewMuteListEvent = async (tags: string[][], content?: string) => {
    if (dayjs().unix() === muteListEvent?.created_at) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const newMuteListDraftEvent = createMuteListDraftEvent(tags, content)
    const event = await publish(newMuteListDraftEvent)
    toast.success(t('Successfully updated mute list'))
    return event
  }

  const checkMuteListEvent = (muteListEvent: Event | null | undefined) => {
    if (!muteListEvent) {
      const result = confirm(t('MuteListNotFoundConfirmation'))

      if (!result) {
        throw new Error('Mute list not found')
      }
    }
  }

  const mutePubkeyPublicly = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await loadLatestMuteListEvent()
      checkMuteListEvent(muteListEvent)
      if (
        muteListEvent &&
        muteListEvent.tags.some(
          ([tagName, tagValue]) => tagName === 'p' && tagValue?.toLowerCase() === pubkey.toLowerCase()
        )
      ) {
        return
      }
      const newTags = dedupePTagsAppendPubkey(muteListEvent?.tags ?? [], pubkey)
      const newMuteListEvent = await publishNewMuteListEvent(newTags, muteListEvent?.content)
      const privateTags = await getPrivateTags(newMuteListEvent)
      await updateMuteListEvent(newMuteListEvent, privateTags)
    } catch (error) {
      toast.error(t('Failed to mute user publicly') + ': ' + (error as Error).message)
    } finally {
      setChanging(false)
    }
  }

  const mutePubkeyPrivately = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await loadLatestMuteListEvent()
      checkMuteListEvent(muteListEvent)
      const privateTags = muteListEvent ? await getPrivateTags(muteListEvent) : []
      if (
        privateTags.some(
          ([tagName, tagValue]) => tagName === 'p' && tagValue?.toLowerCase() === pubkey.toLowerCase()
        )
      ) {
        return
      }

      const newPrivateTags = dedupePTagsAppendPubkey(privateTags, pubkey)
      const cipherText = await nip04Encrypt(accountPubkey, JSON.stringify(newPrivateTags))
      const newMuteListEvent = await publishNewMuteListEvent(muteListEvent?.tags ?? [], cipherText)
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } catch (error) {
      toast.error(t('Failed to mute user privately') + ': ' + (error as Error).message)
    } finally {
      setChanging(false)
    }
  }

  const unmutePubkey = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await loadLatestMuteListEvent()
      if (!muteListEvent) return

      const privateTags = await getPrivateTags(muteListEvent)
      const newPrivateTags = privateTags.filter(
        (tag) => !(tag[0] === 'p' && tag[1]?.toLowerCase() === pubkey.toLowerCase())
      )
      let cipherText = muteListEvent.content
      if (newPrivateTags.length !== privateTags.length) {
        cipherText = await nip04Encrypt(accountPubkey, JSON.stringify(newPrivateTags))
      }

      const newMuteListEvent = await publishNewMuteListEvent(
        removePubkeyFromPTags(muteListEvent.tags, pubkey),
        cipherText
      )
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } finally {
      setChanging(false)
    }
  }

  const switchToPublicMute = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await loadLatestMuteListEvent()
      if (!muteListEvent) return

      const privateTags = await getPrivateTags(muteListEvent)
      const newPrivateTags = privateTags.filter(
        (tag) => !(tag[0] === 'p' && tag[1]?.toLowerCase() === pubkey.toLowerCase())
      )
      if (newPrivateTags.length === privateTags.length) {
        return
      }

      const cipherText = await nip04Encrypt(accountPubkey, JSON.stringify(newPrivateTags))
      const newMuteListEvent = await publishNewMuteListEvent(
        dedupePTagsAppendPubkey(removePubkeyFromPTags(muteListEvent.tags, pubkey), pubkey),
        cipherText
      )
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } finally {
      setChanging(false)
    }
  }

  const switchToPrivateMute = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await loadLatestMuteListEvent()
      if (!muteListEvent) return

      const newTags = removePubkeyFromPTags(muteListEvent.tags, pubkey)
      if (newTags.length === muteListEvent.tags.length) {
        return
      }

      const privateTags = await getPrivateTags(muteListEvent)
      const newPrivateTags = dedupePTagsAppendPubkey(
        privateTags.filter(
          (tag) => !(tag[0] === 'p' && tag[1]?.toLowerCase() === pubkey.toLowerCase())
        ),
        pubkey
      )
      const cipherText = await nip04Encrypt(accountPubkey, JSON.stringify(newPrivateTags))
      const newMuteListEvent = await publishNewMuteListEvent(newTags, cipherText)
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } finally {
      setChanging(false)
    }
  }

  return (
    <MuteListContext.Provider
      value={{
        mutePubkeySet,
        changing,
        getMutePubkeys,
        getMuteType,
        mutePubkeyPublicly,
        mutePubkeyPrivately,
        unmutePubkey,
        switchToPublicMute,
        switchToPrivateMute
      }}
    >
      {children}
    </MuteListContext.Provider>
  )
}
