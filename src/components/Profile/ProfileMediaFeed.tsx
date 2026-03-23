import NoteList, { type TNoteListRef } from '@/components/NoteList'
import { buildProfilePageReadRelayUrls } from '@/lib/favorites-feed-relays'
import logger from '@/lib/logger'
import { normalizeHexPubkey } from '@/lib/pubkey'
import { computeSpellSubRequestsIdentityKey } from '@/lib/spell-feed-request-identity'
import { buildProfileMediaSubRequests, PROFILE_MEDIA_TAB_KINDS } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { normalizeUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function relayListsContentKey(favoriteRelays: string[], blockedRelays: string[]): string {
  const fav = [...favoriteRelays].map((u) => normalizeUrl(u) || u).filter(Boolean).sort().join('\u0001')
  const blk = [...blockedRelays].map((u) => normalizeUrl(u) || u).filter(Boolean).sort().join('\u0001')
  return `${fav}\u0000${blk}`
}

const MEDIA_LOG = '[ProfileMedia]'

const ProfileMediaFeed = forwardRef<TNoteListRef, { pubkey: string }>(({ pubkey }, ref) => {
  const { t } = useTranslation()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const relayListsKey = useMemo(
    () => relayListsContentKey(favoriteRelays, blockedRelays),
    [favoriteRelays, blockedRelays]
  )

  /**
   * Start REQ immediately with the same stack as “no NIP-65 yet” (favorites + fast-read), then refine when
   * {@link client.fetchRelayList} returns — avoids an empty/skeleton Medien tab while Posts already shows cache.
   */
  const provisionalProfileRelayUrls = useMemo(() => {
    if (!pubkey?.trim()) return [] as string[]
    return buildProfilePageReadRelayUrls(
      favoriteRelays,
      blockedRelays,
      { read: [] as string[], write: [] as string[] },
      false
    )
  }, [pubkey, relayListsKey, favoriteRelays, blockedRelays])

  const [refinedProfileRelayUrls, setRefinedProfileRelayUrls] = useState<string[] | null>(null)

  useEffect(() => {
    const pk = pubkey?.trim()
    if (!pk) {
      logger.debug(`${MEDIA_LOG} empty pubkey — no relay resolution`)
      setRefinedProfileRelayUrls([])
      return
    }
    let cancelled = false
    setRefinedProfileRelayUrls(null)
    void (async () => {
      const authorRl = await client.fetchRelayList(pk).catch(() => ({
        read: [] as string[],
        write: [] as string[]
      }))
      if (cancelled) return
      const profileStack = buildProfilePageReadRelayUrls(
        favoriteRelays,
        blockedRelays,
        authorRl,
        false
      )
      const hexPk = normalizeHexPubkey(pk)
      logger.debug(`${MEDIA_LOG} NIP-65 stack resolved for media tab`, {
        pubkey: hexPk.slice(0, 8),
        authorReadCount: authorRl.read?.length ?? 0,
        authorWriteCount: authorRl.write?.length ?? 0,
        profileRelayCount: profileStack.length,
        profileRelaysSample: profileStack.slice(0, 4)
      })
      logger.debug(`${MEDIA_LOG} full profile relay stack`, { profileRelays: profileStack })
      setRefinedProfileRelayUrls(profileStack)
    })()
    return () => {
      cancelled = true
    }
  }, [pubkey, relayListsKey, favoriteRelays, blockedRelays])

  const profileRelayUrls = refinedProfileRelayUrls ?? provisionalProfileRelayUrls

  const subRequests = useMemo(() => {
    const pk = pubkey?.trim()
    if (!pk) return []
    return buildProfileMediaSubRequests(profileRelayUrls, blockedRelays, pk)
  }, [pubkey, profileRelayUrls, blockedRelays])

  const feedSubscriptionKey = useMemo(
    () => computeSpellSubRequestsIdentityKey(subRequests),
    [subRequests]
  )

  useEffect(() => {
    const pk = pubkey?.trim()
    if (!pk) return
    if (!subRequests.length) {
      logger.debug(`${MEDIA_LOG} buildProfileMediaSubRequests returned no URLs (blocked or empty stacks)`, {
        pubkey: normalizeHexPubkey(pk).slice(0, 8),
        profileRelayCount: profileRelayUrls.length
      })
      return
    }
    const sr = subRequests[0]!
    logger.debug(`${MEDIA_LOG} subRequests ready for NoteList`, {
      pubkey: normalizeHexPubkey(pk).slice(0, 8),
      feedSubscriptionKey,
      relayCount: sr.urls.length,
      filterAuthors: sr.filter.authors,
      filterKinds: sr.filter.kinds,
      filterLimit: sr.filter.limit
    })
    logger.debug(`${MEDIA_LOG} augmented relay URLs`, { urls: sr.urls })
  }, [pubkey, profileRelayUrls, subRequests, feedSubscriptionKey, refinedProfileRelayUrls])

  const showKinds = useMemo(() => [...PROFILE_MEDIA_TAB_KINDS], [])

  if (!pubkey?.trim()) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {t('Nothing to load for this feed.')}
      </div>
    )
  }

  if (!subRequests.length) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {t('Nothing to load for this feed.')}
      </div>
    )
  }

  return (
    <div className="min-h-[min(40vh,320px)] min-w-0">
      <NoteList
        ref={ref}
        subRequests={subRequests}
        feedSubscriptionKey={feedSubscriptionKey}
        showKinds={showKinds}
        useFilterAsIs
        /**
         * Provisional relay stack (favorites + fast read) then NIP-65 refinement changes URLs without changing the
         * REQ filter — merge so we do not wipe rows or re-enter a long loading state.
         */
        preserveTimelineOnSubRequestsChange
        mergeTimelineWhenSubRequestFiltersMatch
        /** Same live {@link client.subscribeTimeline} path as {@link useProfileTimeline} on the Posts tab; filter is native media kinds only. */
        revealBatchSize={20}
        filterMutedNotes={false}
        showKind1OPs
        showKind1Replies
        showKind1111
        hideReplies={false}
      />
    </div>
  )
})

ProfileMediaFeed.displayName = 'ProfileMediaFeed'

export default ProfileMediaFeed
