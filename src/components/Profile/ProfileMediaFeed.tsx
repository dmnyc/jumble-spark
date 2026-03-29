import NoteList, { type TNoteListRef } from '@/components/NoteList'
import { buildAuthorInboxOutboxRelayUrls } from '@/lib/favorites-feed-relays'
import logger from '@/lib/logger'
import { normalizeHexPubkey } from '@/lib/pubkey'
import { computeSpellSubRequestsIdentityKey } from '@/lib/spell-feed-request-identity'
import { PROFILE_MEDIA_TAB_KINDS } from '@/constants'
import { buildProfileMediaSubRequests } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { normalizeUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function blockedRelaysContentKey(blockedRelays: string[]): string {
  return [...blockedRelays].map((u) => normalizeUrl(u) || u).filter(Boolean).sort().join('\u0001')
}

const MEDIA_LOG = '[ProfileMedia]'

const ProfileMediaFeed = forwardRef<TNoteListRef, { pubkey: string }>(({ pubkey }, ref) => {
  const { t } = useTranslation()
  const { blockedRelays } = useFavoriteRelays()
  const blockedKey = useMemo(() => blockedRelaysContentKey(blockedRelays), [blockedRelays])

  /**
   * Before NIP-65: empty author tier so REQ still uses read-only + fast-read; refine when
   * {@link client.fetchRelayList} returns.
   */
  const provisionalAuthorRelayUrls = useMemo(() => {
    if (!pubkey?.trim()) return [] as string[]
    return buildAuthorInboxOutboxRelayUrls({ read: [], write: [] }, blockedRelays)
  }, [pubkey, blockedKey, blockedRelays])

  const [refinedAuthorRelayUrls, setRefinedAuthorRelayUrls] = useState<string[] | null>(null)

  useEffect(() => {
    const pk = pubkey?.trim()
    if (!pk) {
      logger.debug(`${MEDIA_LOG} empty pubkey — no relay resolution`)
      setRefinedAuthorRelayUrls([])
      return
    }
    let cancelled = false
    setRefinedAuthorRelayUrls(null)
    void (async () => {
      const authorRl = await client.fetchRelayList(pk).catch(() => ({
        read: [] as string[],
        write: [] as string[]
      }))
      if (cancelled) return
      const authorStack = buildAuthorInboxOutboxRelayUrls(authorRl, blockedRelays)
      const hexPk = normalizeHexPubkey(pk)
      logger.debug(`${MEDIA_LOG} NIP-65 author relays resolved for media tab`, {
        pubkey: hexPk.slice(0, 8),
        authorReadCount: authorRl.read?.length ?? 0,
        authorWriteCount: authorRl.write?.length ?? 0,
        authorRelayCount: authorStack.length,
        authorRelaysSample: authorStack.slice(0, 4)
      })
      logger.debug(`${MEDIA_LOG} author inbox/outbox relay list`, { authorRelays: authorStack })
      setRefinedAuthorRelayUrls(authorStack)
    })()
    return () => {
      cancelled = true
    }
  }, [pubkey, blockedKey, blockedRelays])

  const authorRelayUrls = refinedAuthorRelayUrls ?? provisionalAuthorRelayUrls

  const subRequests = useMemo(() => {
    const pk = pubkey?.trim()
    if (!pk) return []
    return buildProfileMediaSubRequests(authorRelayUrls, blockedRelays, pk)
  }, [pubkey, authorRelayUrls, blockedRelays])

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
        authorRelayCount: authorRelayUrls.length
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
  }, [pubkey, authorRelayUrls, subRequests, feedSubscriptionKey, refinedAuthorRelayUrls])

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
        hostPrimaryPageName="profile"
        showKinds={showKinds}
        useFilterAsIs
        /**
         * Provisional author tier (empty) then NIP-65 inbox/outbox refinement; REQ filter unchanged — merge rows.
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
