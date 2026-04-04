import LatestFromFollowsSection from '@/components/LatestFromFollowsSection'
import { RefreshButton } from '@/components/RefreshButton'
import PrimaryPageLayout, { TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { TPageRef } from '@/types'
import { UsersRound } from 'lucide-react'
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const FollowsLatestPage = forwardRef<TPageRef>(function FollowsLatestPage(_, ref) {
  const { t } = useTranslation()
  const [refreshKey, setRefreshKey] = useState(0)
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior: ScrollBehavior = 'smooth') => layoutRef.current?.scrollToTop(behavior),
      refresh: bumpRefresh
    }),
    [bumpRefresh]
  )

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="follows-latest"
      titlebar={<FollowsLatestPageTitlebar onRefresh={bumpRefresh} />}
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-4 px-4 pb-8">
        <p className="mb-4 max-w-prose text-sm text-muted-foreground leading-relaxed">
          {t('Follows latest page description')}
        </p>
        <LatestFromFollowsSection refreshKey={refreshKey} variant="page" />
      </div>
    </PrimaryPageLayout>
  )
})

FollowsLatestPage.displayName = 'FollowsLatestPage'
export default FollowsLatestPage

function FollowsLatestPageTitlebar({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full items-center justify-between gap-2 pr-1">
      <div className="flex items-center gap-2 pl-3">
        <UsersRound className="size-5" />
        <div className="app-chrome-title">{t('Follows latest page title')}</div>
      </div>
      <RefreshButton onClick={onRefresh} />
    </div>
  )
}
