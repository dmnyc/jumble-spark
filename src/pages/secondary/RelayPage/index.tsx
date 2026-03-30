import type { TNoteListRef } from '@/components/NoteList'
import Relay from '@/components/Relay'
import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { normalizeUrl, simplifyUrl } from '@/lib/url'
import client from '@/services/client.service'
import { forwardRef, useCallback, useEffect, useMemo, useRef } from 'react'
import NotFoundPage from '../NotFoundPage'

const RelayPage = forwardRef(({ url, index, hideTitlebar = false }: { url?: string; index?: number; hideTitlebar?: boolean }, ref) => {
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const feedRef = useRef<TNoteListRef>(null)
  const normalizedUrl = useMemo(() => (url ? normalizeUrl(url) : undefined), [url])
  const title = useMemo(() => (url ? simplifyUrl(url) : undefined), [url])

  const bumpFeed = useCallback(() => {
    if (normalizedUrl) client.clearSessionRelayStrikeForUrl(normalizedUrl)
    feedRef.current?.refresh()
  }, [normalizedUrl])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bumpFeed)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bumpFeed])

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
      <Relay ref={feedRef} url={normalizedUrl} />
    </SecondaryPageLayout>
  )
})
RelayPage.displayName = 'RelayPage'
export default RelayPage
