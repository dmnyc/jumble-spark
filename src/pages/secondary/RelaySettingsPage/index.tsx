import HttpRelaysSetting from '@/components/HttpRelaysSetting'
import JsonViewDialog from '@/components/JsonViewDialog'
import MailboxSetting from '@/components/MailboxSetting'
import FavoriteRelaysSetting from '@/components/FavoriteRelaysSetting'
import SessionRelaysTab from '@/components/SessionRelaysTab'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ExtendedKind } from '@/constants'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useNostr } from '@/providers/NostrProvider'
import indexedDb from '@/services/indexed-db.service'
import { Code, MoreVertical } from 'lucide-react'
import { kinds } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const RelaySettingsPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const { account, relayList } = useNostr()
  const [contentKey, setContentKey] = useState(0)
  const bump = useCallback(() => setContentKey((k) => k + 1), [])
  const [tabValue, setTabValue] = useState('favorite-relays')
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonPayload, setJsonPayload] = useState<unknown>(null)

  const openRelayListJson = useCallback(async () => {
    const pk = account?.pubkey
    if (!pk) {
      setJsonPayload({ error: 'Not logged in' })
      setJsonOpen(true)
      return
    }
    const [k10002, k10432, k10243] = await Promise.all([
      indexedDb.getReplaceableEvent(pk, kinds.RelayList).catch(() => null),
      indexedDb.getReplaceableEvent(pk, ExtendedKind.CACHE_RELAYS).catch(() => null),
      indexedDb.getReplaceableEvent(pk, ExtendedKind.HTTP_RELAY_LIST).catch(() => null)
    ])
    setJsonPayload({
      pubkey: pk,
      mergedRelayList: relayList,
      kind10002_mailbox_fromIndexedDb: k10002 ?? null,
      kind10432_cacheRelays_fromIndexedDb: k10432 ?? null,
      kind10243_httpRelayList_fromIndexedDb: k10243 ?? null,
      note:
        'Merged list is from the client cache service. IndexedDB values are your locally stored replaceable lists.'
    })
    setJsonOpen(true)
  }, [account?.pubkey, relayList])

  useEffect(() => {
    switch (window.location.hash) {
      case '#http-relays':
        setTabValue('http-relays')
        break
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
      controls={
        hideTitlebar ? undefined : (
          <div className="flex items-center gap-0">
            <RefreshButton onClick={bump} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('More options')}>
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void openRelayListJson()}>
                  <Code className="size-4 mr-2" />
                  {t('View JSON')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      }
    >
      <JsonViewDialog value={jsonPayload} isOpen={jsonOpen} onClose={() => setJsonOpen(false)} />
      <Tabs key={contentKey} value={tabValue} onValueChange={setTabValue} className="px-4 py-3 space-y-4">
        <TabsList className="flex-col sm:flex-row h-auto sm:h-9">
          <TabsTrigger value="favorite-relays" className="w-full sm:w-auto">{t('Favorite Relays')}</TabsTrigger>
          <TabsTrigger value="mailbox" className="w-full sm:w-auto">{t('Read & Write Relays')}</TabsTrigger>
          <TabsTrigger value="http-relays" className="w-full sm:w-auto">{t('HTTP relays')}</TabsTrigger>
          <TabsTrigger value="session-relays" className="w-full sm:w-auto">{t('Session relays')}</TabsTrigger>
        </TabsList>
        <TabsContent value="favorite-relays">
          <FavoriteRelaysSetting />
        </TabsContent>
        <TabsContent value="mailbox">
          <MailboxSetting />
        </TabsContent>
        <TabsContent value="http-relays">
          <HttpRelaysSetting />
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
