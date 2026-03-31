import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { cn } from '@/lib/utils'
import {
  useSmartBookmarkListNavigation,
  useSmartFollowingListNavigation,
  useSmartInterestListNavigation,
  useSmartMuteListNavigation,
  useSmartPinListNavigation,
  useSmartSettingsNavigation
} from '@/PageManager'
import {
  toBookmarksList,
  toFollowSetsSettings,
  toFollowingList,
  toInterestsList,
  toMuteList,
  toPinsList
} from '@/lib/link'
import { useNostr } from '@/providers/NostrProvider'
import { Bookmark, ChevronRight, Hash, Pin, Users, VolumeX } from 'lucide-react'
import { forwardRef, HTMLProps, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Hub for Nostr “personal lists” (mute list, follows, NIP-51 bookmarks, pins, interest topics) — not the same as NIP-B0 web bookmarks.
 */
const PersonalListsSettingsPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { pubkey } = useNostr()
    const { navigate: navigatePrimary } = usePrimaryPage()
    const { navigateToSettings } = useSmartSettingsNavigation()
    const { navigateToMuteList } = useSmartMuteListNavigation()
    const { navigateToFollowingList } = useSmartFollowingListNavigation()
    const { navigateToBookmarkList } = useSmartBookmarkListNavigation()
    const { navigateToPinList } = useSmartPinListNavigation()
    const { navigateToInterestList } = useSmartInterestListNavigation()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const [contentKey, setContentKey] = useState(0)
    const bump = useCallback(() => setContentKey((k) => k + 1), [])

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
        title={hideTitlebar ? undefined : t('Personal Lists')}
        controls={hideTitlebar ? undefined : <RefreshButton onClick={bump} />}
      >
        <div key={contentKey} className="min-w-0 space-y-1 px-1 pt-2">
          <p className="px-3 pb-3 text-sm text-muted-foreground">{t('Personal lists hub intro')}</p>
          <SettingRow className="clickable" onClick={() => navigateToMuteList(toMuteList())}>
            <div className="flex items-center gap-3">
              <VolumeX />
              <div>{t('Mute list')}</div>
            </div>
            <ChevronRight />
          </SettingRow>
          {pubkey ? (
            <SettingRow
              className="clickable"
              onClick={() => navigateToFollowingList(toFollowingList(pubkey))}
            >
              <div className="flex items-center gap-3">
                <Users />
                <div>{t('Following list')}</div>
              </div>
              <ChevronRight />
            </SettingRow>
          ) : null}
          {pubkey ? (
            <SettingRow className="clickable" onClick={() => navigateToBookmarkList(toBookmarksList())}>
              <div className="flex items-center gap-3">
                <Bookmark />
                <div>{t('Bookmarks list')}</div>
              </div>
              <ChevronRight />
            </SettingRow>
          ) : null}
          {pubkey ? (
            <SettingRow className="clickable" onClick={() => navigateToPinList(toPinsList())}>
              <div className="flex items-center gap-3">
                <Pin />
                <div>{t('Pinned notes list')}</div>
              </div>
              <ChevronRight />
            </SettingRow>
          ) : null}
          {pubkey ? (
            <SettingRow className="clickable" onClick={() => navigateToInterestList(toInterestsList())}>
              <div className="flex items-center gap-3">
                <Hash />
                <div>{t('Interests list')}</div>
              </div>
              <ChevronRight />
            </SettingRow>
          ) : null}
          <SettingRow className="clickable" onClick={() => navigateToSettings(toFollowSetsSettings())}>
            <div className="flex items-center gap-3">
              <Users />
              <div>{t('Follow sets')}</div>
            </div>
            <ChevronRight />
          </SettingRow>
          <p className="flex min-h-[52px] items-start gap-3 rounded-lg px-4 py-2 text-sm text-muted-foreground">
            <Bookmark className="mt-0.5 size-4 shrink-0 opacity-80" />
            <span>
              {t('Personal lists bookmarks spell hint')}{' '}
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => navigatePrimary('spells', { spell: 'bookmarks' })}
              >
                {t('Bookmarks spell')}
              </button>
            </span>
          </p>
          <p className="flex min-h-[52px] items-start gap-3 rounded-lg px-4 py-2 text-sm text-muted-foreground">
            <Hash className="mt-0.5 size-4 shrink-0 opacity-80" />
            <span>
              {t('Personal lists interests spell hint')}{' '}
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => navigatePrimary('spells', { spell: 'interests' })}
              >
                {t('Interests spell')}
              </button>
            </span>
          </p>
        </div>
      </SecondaryPageLayout>
    )
  }
)

PersonalListsSettingsPage.displayName = 'PersonalListsSettingsPage'
export default PersonalListsSettingsPage

const SettingRow = forwardRef<HTMLDivElement, HTMLProps<HTMLDivElement>>(
  ({ children, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-[52px] select-none items-center justify-between rounded-lg px-4 py-2 [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)
SettingRow.displayName = 'SettingRow'
