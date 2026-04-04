import type { TNoteListRef } from '@/components/NoteList'
import { RefreshButton } from '@/components/RefreshButton'
import Relay from '@/components/Relay'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { TPageRef } from '@/types'
import { normalizeUrl, simplifyUrl } from '@/lib/url'
import client from '@/services/client.service'
import { Server } from 'lucide-react'
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react'

const RelayPage = forwardRef<TPageRef, { url?: string }>(({ url }, ref) => {
  const normalizedUrl = useMemo(() => (url ? normalizeUrl(url) : undefined), [url])
  const layoutRef = useRef<TPageRef>(null)
  const feedRef = useRef<TNoteListRef>(null)

  const runRefresh = useCallback(() => {
    if (normalizedUrl) client.clearSessionRelayStrikeForUrl(normalizedUrl)
    feedRef.current?.refresh()
  }, [normalizedUrl])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: runRefresh
    }),
    [runRefresh]
  )

  return (
    <PrimaryPageLayout
      pageName="relay"
      titlebar={<RelayPageTitlebar url={normalizedUrl} onRefresh={runRefresh} />}
      displayScrollToTopButton
      ref={layoutRef}
    >
      <div className="min-w-0 pt-2">
        <Relay ref={feedRef} url={normalizedUrl} hostPrimaryPageName="relay" />
      </div>
    </PrimaryPageLayout>
  )
})
RelayPage.displayName = 'RelayPage'
export default RelayPage

function RelayPageTitlebar({ url, onRefresh }: { url?: string; onRefresh: () => void }) {
  return (
    <div className="flex w-full items-center justify-between gap-2 px-1 h-full">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
        <Server />
        <div className="app-chrome-title truncate">{simplifyUrl(url ?? '')}</div>
      </div>
      <RefreshButton onClick={onRefresh} />
    </div>
  )
}
