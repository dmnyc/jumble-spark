import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { createFollowListDraftEvent } from '@/lib/draft-event'
import {
  dedupePTagsAppendPubkey,
  fetchLatestReplaceableListEvent,
  removePubkeyFromPTags
} from '@/lib/replaceable-list-latest'
import { getPubkeysFromPTags } from '@/lib/tag'
import client from '@/services/client.service'
import { kinds } from 'nostr-tools'
import { useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNostr } from './NostrProvider'
import { useFavoriteRelays } from './FavoriteRelaysProvider'
import { FollowListContext } from './follow-list-context'

export function FollowListProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey, followListEvent, publish, updateFollowListEvent } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const followings = useMemo(
    () => (followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []),
    [followListEvent]
  )

  const buildMergeRelays = useCallback(async () => {
    if (!accountPubkey) return [] as string[]
    return buildAccountListRelayUrlsForMerge({
      accountPubkey,
      favoriteRelays: favoriteRelays ?? [],
      blockedRelays
    })
  }, [accountPubkey, favoriteRelays, blockedRelays])

  const follow = async (pubkey: string) => {
    if (!accountPubkey) return

    const relays = await buildMergeRelays()
    let latest =
      (await fetchLatestReplaceableListEvent(accountPubkey, kinds.Contacts, relays)) ?? null
    if (!latest) {
      latest = (await client.fetchFollowListEvent(accountPubkey)) ?? null
    }
    if (!latest) {
      const result = confirm(t('FollowListNotFoundConfirmation'))

      if (!result) {
        return
      }
    }
    const mergedTags = dedupePTagsAppendPubkey(latest?.tags ?? [], pubkey)
    const newFollowListDraftEvent = createFollowListDraftEvent(mergedTags, latest?.content)
    const newFollowListEvent = await publish(newFollowListDraftEvent)
    await updateFollowListEvent(newFollowListEvent)
  }

  const unfollow = async (pubkey: string) => {
    if (!accountPubkey) return

    const relays = await buildMergeRelays()
    let latest =
      (await fetchLatestReplaceableListEvent(accountPubkey, kinds.Contacts, relays)) ?? null
    if (!latest) {
      latest = (await client.fetchFollowListEvent(accountPubkey)) ?? null
    }
    if (!latest) return

    const newFollowListDraftEvent = createFollowListDraftEvent(
      removePubkeyFromPTags(latest.tags, pubkey),
      latest.content
    )
    const newFollowListEvent = await publish(newFollowListDraftEvent)
    await updateFollowListEvent(newFollowListEvent)
  }

  return (
    <FollowListContext.Provider
      value={{
        followings,
        follow,
        unfollow
      }}
    >
      {children}
    </FollowListContext.Provider>
  )
}
