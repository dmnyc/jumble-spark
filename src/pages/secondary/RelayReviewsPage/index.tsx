import type { TNoteListRef } from '@/components/NoteList'
import NoteList from '@/components/NoteList'
import { RefreshButton } from '@/components/RefreshButton'
import { FAST_READ_RELAY_URLS, ExtendedKind } from '@/constants'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { relayReviewDTagsForRelayUrl, relayReviewsFeedSnapshotKey } from '@/lib/relay-review-feed'
import { normalizeAnyRelayUrl, simplifyUrl } from '@/lib/url'
import type { TFeedSubRequest } from '@/types'
import { forwardRef, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import NotFoundPage from '../NotFoundPage'

const RelayReviewsPage = forwardRef(({ url, index, hideTitlebar = false }: { url?: string; index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const feedRef = useRef<TNoteListRef>(null)
  const bumpFeed = useCallback(() => feedRef.current?.refresh(), [])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bumpFeed)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bumpFeed])

  const normalizedUrl = useMemo(() => (url ? normalizeAnyRelayUrl(url) : undefined), [url])
  /** `d` tag values vary by client (raw vs normalized URL); REQ must OR-match every variant. */
  const relayReviewDTags = useMemo(
    () => (url ? relayReviewDTagsForRelayUrl(url) : []),
    [url]
  )
  /** Stable identity for session feed snapshot (decoupled from FAST_READ_RELAY_URLS JSON churn). */
  const relayReviewsFeedSubscriptionKey = useMemo(
    () => (normalizedUrl ? relayReviewsFeedSnapshotKey(normalizedUrl) : ''),
    [normalizedUrl]
  )
  const reviewsSubRequests = useMemo<TFeedSubRequest[]>(() => {
    if (!normalizedUrl || relayReviewDTags.length === 0) return []
    return [
      {
        urls: [normalizedUrl, ...FAST_READ_RELAY_URLS],
        filter: {
          kinds: [ExtendedKind.RELAY_REVIEW],
          '#d': relayReviewDTags,
          limit: 100
        }
      }
    ]
  }, [normalizedUrl, relayReviewDTags])
  const title = useMemo(
    () => (url ? t('Reviews for {{relay}}', { relay: simplifyUrl(url) }) : undefined),
    [url, t]
  )

  if (!normalizedUrl) {
    return <NotFoundPage ref={ref} />
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : title}
      controls={hideTitlebar ? undefined : <RefreshButton onClick={bumpFeed} />}
      displayScrollToTopButton
    >
      <NoteList
        ref={feedRef}
        showKinds={[ExtendedKind.RELAY_REVIEW]}
        subRequests={reviewsSubRequests}
        feedSubscriptionKey={relayReviewsFeedSubscriptionKey}
        useFilterAsIs
      />
    </SecondaryPageLayout>
  )
})
RelayReviewsPage.displayName = 'RelayReviewsPage'
export default RelayReviewsPage
