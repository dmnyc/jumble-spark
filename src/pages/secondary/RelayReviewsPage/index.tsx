import type { TNoteListRef } from '@/components/NoteList'
import NoteList from '@/components/NoteList'
import { RefreshButton } from '@/components/RefreshButton'
import { FAST_READ_RELAY_URLS, ExtendedKind } from '@/constants'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/PageManager'
import { normalizeUrl, simplifyUrl } from '@/lib/url'
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

  const normalizedUrl = useMemo(() => (url ? normalizeUrl(url) : undefined), [url])
  const title = useMemo(
    () => (url ? t('Reviews for {{relay}}', { relay: simplifyUrl(url) }) : undefined),
    [url]
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
        subRequests={[
          {
            urls: [normalizedUrl, ...FAST_READ_RELAY_URLS],
            filter: { '#d': [normalizedUrl] }
          }
        ]}
      />
    </SecondaryPageLayout>
  )
})
RelayReviewsPage.displayName = 'RelayReviewsPage'
export default RelayReviewsPage
