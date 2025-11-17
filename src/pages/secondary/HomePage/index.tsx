import { useSecondaryPage, useSmartRelayNavigation } from '@/PageManager'
import RelaySimpleInfo from '@/components/RelaySimpleInfo'
import { Button } from '@/components/ui/button'
import { RECOMMENDED_RELAYS } from '@/constants'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { toRelay } from '@/lib/link'
import relayInfoService from '@/services/relay-info.service'
import { TRelayInfo } from '@/types'
import { ArrowRight, Server } from 'lucide-react'
import { forwardRef, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import logger from '@/lib/logger'

const HomePage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { navigateToPrimaryPage } = useSecondaryPage()
  const { navigateToRelay } = useSmartRelayNavigation()
  // DEPRECATED: updateShowRecommendedRelaysPanel removed - double-panel functionality disabled
  const [recommendedRelayInfos, setRecommendedRelayInfos] = useState<TRelayInfo[]>([])

  useEffect(() => {
    const init = async () => {
      try {
        const relays = await relayInfoService.getRelayInfos(RECOMMENDED_RELAYS)
        setRecommendedRelayInfos(relays.filter(Boolean) as TRelayInfo[])
      } catch (error) {
        logger.error('Failed to fetch recommended relays', { error })
      }
    }
    init()
  }, [])

  if (!recommendedRelayInfos.length) {
    return (
      <SecondaryPageLayout ref={ref} index={index} hideBackButton hideTitlebarBottomBorder>
        <div className="text-muted-foreground w-full h-screen flex items-center justify-center">
          {t('Welcome! 🥳')}
        </div>
      </SecondaryPageLayout>
    )
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={
        <div className="flex items-center gap-2">
          <Server />
          <div>{t('Recommended relays')}</div>
        </div>
      }
      controls={
        // DEPRECATED: Close button removed - double-panel functionality disabled
        null
      }
      hideBackButton
      hideTitlebarBottomBorder
    >
      <div className="px-4 pt-2">
        <div className="grid grid-cols-2 gap-3">
          {recommendedRelayInfos.map((relayInfo) => (
            <RelaySimpleInfo
              key={relayInfo.url}
              className="clickable h-auto px-4 py-3 rounded-lg border"
              relayInfo={relayInfo}
              onClick={(e) => {
                e.stopPropagation()
                navigateToRelay(toRelay(relayInfo.url))
              }}
            />
          ))}
        </div>
        <div className="flex mt-2 justify-center">
          <Button variant="ghost" onClick={() => navigateToPrimaryPage('explore')}>
            <div>{t('Explore more')}</div>
            <ArrowRight />
          </Button>
        </div>
      </div>
    </SecondaryPageLayout>
  )
})
HomePage.displayName = 'HomePage'
export default HomePage
