import NoteList, { type TNoteListRef } from '@/components/NoteList'
import { buildProfilePageReadRelayUrls } from '@/lib/favorites-feed-relays'
import { computeSpellSubRequestsIdentityKey } from '@/lib/spell-feed-request-identity'
import {
  applyFauxSpellCapsToSubRequests,
  appendCuratedReadOnlyRelays,
  buildProfileMediaSpellFilter,
  MEDIA_SPELL_KINDS,
  PROFILE_MEDIA_REQ_LIMIT
} from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import { normalizeUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function relayListsContentKey(favoriteRelays: string[], blockedRelays: string[]): string {
  const fav = [...favoriteRelays].map((u) => normalizeUrl(u) || u).filter(Boolean).sort().join('\u0001')
  const blk = [...blockedRelays].map((u) => normalizeUrl(u) || u).filter(Boolean).sort().join('\u0001')
  return `${fav}\u0000${blk}`
}

const ProfileMediaFeed = forwardRef<TNoteListRef, { pubkey: string }>(({ pubkey }, ref) => {
  const { t } = useTranslation()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const relayListsKey = useMemo(
    () => relayListsContentKey(favoriteRelays, blockedRelays),
    [favoriteRelays, blockedRelays]
  )

  /** `null` = still resolving viewed profile NIP-65 + merged relay stack (same as pins / main profile feed). */
  const [profileRelayUrls, setProfileRelayUrls] = useState<string[] | null>(null)

  useEffect(() => {
    const pk = pubkey?.trim()
    if (!pk) {
      setProfileRelayUrls([])
      return
    }
    let cancelled = false
    setProfileRelayUrls(null)
    void (async () => {
      const authorRl = await client.fetchRelayList(pk).catch(() => ({
        read: [] as string[],
        write: [] as string[]
      }))
      if (cancelled) return
      setProfileRelayUrls(
        buildProfilePageReadRelayUrls(favoriteRelays, blockedRelays, authorRl, false)
      )
    })()
    return () => {
      cancelled = true
    }
  }, [pubkey, relayListsKey, favoriteRelays, blockedRelays])

  const subRequests = useMemo(() => {
    const pk = pubkey?.trim()
    if (!pk || profileRelayUrls === null) return []
    const urls = appendCuratedReadOnlyRelays(profileRelayUrls, blockedRelays)
    if (!urls.length) return []
    return applyFauxSpellCapsToSubRequests([
      { urls, filter: buildProfileMediaSpellFilter(pk) }
    ])
  }, [pubkey, profileRelayUrls, blockedRelays])

  const feedSubscriptionKey = useMemo(
    () => computeSpellSubRequestsIdentityKey(subRequests),
    [subRequests]
  )

  const showKinds = useMemo(() => [...MEDIA_SPELL_KINDS], [])

  if (!pubkey?.trim()) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {t('Nothing to load for this feed.')}
      </div>
    )
  }

  if (profileRelayUrls === null) {
    return (
      <div
        className="min-h-[min(40vh,320px)] space-y-2 px-1 py-4"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <NoteCardLoadingSkeleton key={i} />
        ))}
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
        oneShotFetch
        oneShotMergedCap={PROFILE_MEDIA_REQ_LIMIT}
        revealBatchSize={20}
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
