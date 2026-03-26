import LatestFromFollowsSection from '@/components/LatestFromFollowsSection'
import { RefreshButton } from '@/components/RefreshButton'
import PrimaryPageLayout, { TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { TPageRef } from '@/types'
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
      titlebar={null}
      displayScrollToTopButton
    >
      <div className="min-w-0 pt-4 px-4 pb-8">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">{t('Follows latest page title')}</h1>
            <p className="max-w-prose text-sm text-muted-foreground leading-relaxed">
              {t('Follows latest page description')}
            </p>
          </div>
          <div className="shrink-0 self-start sm:self-center">
            <RefreshButton onClick={bumpRefresh} />
          </div>
        </div>
        <LatestFromFollowsSection refreshKey={refreshKey} variant="page" />
      </div>
    </PrimaryPageLayout>
  )
})

FollowsLatestPage.displayName = 'FollowsLatestPage'
export default FollowsLatestPage
