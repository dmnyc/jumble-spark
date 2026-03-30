import JsonViewDialog from '@/components/JsonViewDialog'
import ProfileList from '@/components/ProfileList'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useFetchFollowings, useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { Code, MoreVertical } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const FollowingListPage = forwardRef(({ id, index, hideTitlebar = false }: { id?: string; index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const [listRefreshNonce, setListRefreshNonce] = useState(0)
  const { profile } = useFetchProfile(id)
  const { followings } = useFetchFollowings(profile?.pubkey, listRefreshNonce)

  const bumpList = useCallback(() => setListRefreshNonce((n) => n + 1), [])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bumpList)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bumpList])

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={
        hideTitlebar
          ? undefined
          : profile?.username
            ? t("username's following", { username: profile.username })
            : t('Following')
      }
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
                <DropdownMenuItem onClick={() => setJsonOpen(true)}>
                  <Code className="size-4 mr-2" />
                  {t('View JSON')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      }
      displayScrollToTopButton
    >
      <JsonViewDialog value={followJsonPayload} isOpen={jsonOpen} onClose={() => setJsonOpen(false)} />
      <ProfileList pubkeys={followings} />
    </SecondaryPageLayout>
  )
})
FollowingListPage.displayName = 'FollowingListPage'
export default FollowingListPage
