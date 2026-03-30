import JsonViewDialog from '@/components/JsonViewDialog'
import OthersRelayList from '@/components/OthersRelayList'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ExtendedKind } from '@/constants'
import { useFetchProfile, useFetchRelayList } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import indexedDb from '@/services/indexed-db.service'
import { Code, MoreVertical } from 'lucide-react'
import { kinds } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const RelaySettingsPage = forwardRef(({ id, index, hideTitlebar = false }: { id?: string; index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const { profile } = useFetchProfile(id)
  const { relayList } = useFetchRelayList(profile?.pubkey)
  const [listKey, setListKey] = useState(0)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonPayload, setJsonPayload] = useState<unknown>(null)

  const bumpList = useCallback(() => setListKey((k) => k + 1), [])

  const openRelayListJson = useCallback(async () => {
    const pk = profile?.pubkey
    if (!pk) {
      setJsonPayload({ error: 'No profile pubkey' })
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
        'Merged list is from the network/cache service. IndexedDB events appear only if this pubkey’s replaceable lists were stored locally (e.g. after a profile or relay fetch).'
    })
    setJsonOpen(true)
  }, [profile?.pubkey, relayList])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bumpList)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bumpList])

  if (!id || !profile) {
    return null
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : t("username's used relays", { username: profile.username })}
      hideBackButton={hideTitlebar}
      controls={
        hideTitlebar ? undefined : (
          <div className="flex items-center gap-0">
            <RefreshButton onClick={bumpList} />
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
      <div key={listKey} className="px-4 pt-3">
        <OthersRelayList userId={id} />
      </div>
    </SecondaryPageLayout>
  )
})
RelaySettingsPage.displayName = 'RelaySettingsPage'
export default RelaySettingsPage
