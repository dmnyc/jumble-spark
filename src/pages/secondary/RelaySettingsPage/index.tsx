import MailboxSetting from '@/components/MailboxSetting'
import FavoriteRelaysSetting from '@/components/FavoriteRelaysSetting'
import SessionRelaysTab from '@/components/SessionRelaysTab'
import { RefreshButton } from '@/components/RefreshButton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/PageManager'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const RelaySettingsPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const [contentKey, setContentKey] = useState(0)
  const bump = useCallback(() => setContentKey((k) => k + 1), [])
  const [tabValue, setTabValue] = useState('favorite-relays')

  useEffect(() => {
    switch (window.location.hash) {
      case '#mailbox':
        setTabValue('mailbox')
        break
      case '#session-relays':
        setTabValue('session-relays')
        break
      case '#favorite-relays':
        setTabValue('favorite-relays')
        break
    }
  }, [])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bump)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bump])

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : t('Relays and Storage Settings')}
      controls={hideTitlebar ? undefined : <RefreshButton onClick={bump} />}
    >
      <Tabs key={contentKey} value={tabValue} onValueChange={setTabValue} className="px-4 py-3 space-y-4">
        <TabsList className="flex-col sm:flex-row h-auto sm:h-9">
          <TabsTrigger value="favorite-relays" className="w-full sm:w-auto">{t('Favorite Relays')}</TabsTrigger>
          <TabsTrigger value="mailbox" className="w-full sm:w-auto">{t('Read & Write Relays')}</TabsTrigger>
          <TabsTrigger value="session-relays" className="w-full sm:w-auto">{t('Session relays')}</TabsTrigger>
        </TabsList>
        <TabsContent value="favorite-relays">
          <FavoriteRelaysSetting />
        </TabsContent>
        <TabsContent value="mailbox">
          <MailboxSetting />
        </TabsContent>
        <TabsContent value="session-relays">
          <SessionRelaysTab />
        </TabsContent>
      </Tabs>
    </SecondaryPageLayout>
  )
})
RelaySettingsPage.displayName = 'RelaySettingsPage'
export default RelaySettingsPage
