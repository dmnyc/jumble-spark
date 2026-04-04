import { RefreshButton } from '@/components/RefreshButton'
import SettingsMenuBody from '@/components/Settings/SettingsMenuBody'
import PrimaryPageLayout, { type TPrimaryPageLayoutRef } from '@/layouts/PrimaryPageLayout'
import { TPageRef } from '@/types'
import { Settings } from 'lucide-react'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SettingsPrimaryPage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const layoutRef = useRef<TPrimaryPageLayoutRef>(null)
  const [menuKey, setMenuKey] = useState(0)

  const bumpMenu = () => setMenuKey((k) => k + 1)

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: bumpMenu
    }),
    []
  )

  return (
    <PrimaryPageLayout
      ref={layoutRef}
      pageName="settings"
      titlebar={
        <div className="flex h-full w-full items-center justify-between gap-2 pl-3 pr-1">
          <div className="flex items-center gap-2">
            <Settings className="size-5 shrink-0" />
            <div className="app-chrome-title">{t('Settings')}</div>
          </div>
          <RefreshButton onClick={bumpMenu} />
        </div>
      }
      displayScrollToTopButton
    >
      <div key={menuKey} className="min-w-0 px-2 pt-2">
        <SettingsMenuBody />
      </div>
    </PrimaryPageLayout>
  )
})
SettingsPrimaryPage.displayName = 'SettingsPrimaryPage'
export default SettingsPrimaryPage
