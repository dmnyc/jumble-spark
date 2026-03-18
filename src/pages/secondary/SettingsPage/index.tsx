import AboutInfoDialog from '@/components/AboutInfoDialog'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import {
  toGeneralSettings,
  toPostSettings,
  toRelaySettings,
  toCacheSettings,
  toTranslation,
  toWallet,
  toRssFeedSettings
} from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSmartSettingsNavigation } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import {
  Check,
  ChevronRight,
  Copy,
  Database,
  Info,
  KeyRound,
  Languages,
  PencilLine,
  Rss,
  Server,
  Settings2,
  Wallet
} from 'lucide-react'
import { forwardRef, HTMLProps, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SettingsPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { pubkey, nsec, ncryptsec } = useNostr()
  const { navigateToSettings } = useSmartSettingsNavigation()
  const [copiedNsec, setCopiedNsec] = useState(false)
  const [copiedNcryptsec, setCopiedNcryptsec] = useState(false)

  return (
    <SecondaryPageLayout ref={ref} index={index} title={hideTitlebar ? undefined : t('Settings')}>
      <SettingItem className="clickable" onClick={() => navigateToSettings(toGeneralSettings())}>
        <div className="flex items-center gap-4">
          <Settings2 />
          <div>{t('General')}</div>
        </div>
        <ChevronRight />
      </SettingItem>
      <SettingItem className="clickable" onClick={() => navigateToSettings(toRelaySettings())}>
        <div className="flex items-center gap-4">
          <Server />
          <div>{t('Relays and Storage Settings')}</div>
        </div>
        <ChevronRight />
      </SettingItem>
      <SettingItem className="clickable" onClick={() => navigateToSettings(toCacheSettings())}>
        <div className="flex items-center gap-4">
          <Database />
          <div>{t('Cache & offline storage')}</div>
        </div>
        <ChevronRight />
      </SettingItem>
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigateToSettings(toTranslation())}>
          <div className="flex items-center gap-4">
            <Languages />
            <div>{t('Translation')}</div>
          </div>
          <ChevronRight />
        </SettingItem>
      )}
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigateToSettings(toWallet())}>
          <div className="flex items-center gap-4">
            <Wallet />
            <div>{t('Wallet')}</div>
          </div>
          <ChevronRight />
        </SettingItem>
      )}
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigateToSettings(toPostSettings())}>
          <div className="flex items-center gap-4">
            <PencilLine />
            <div>{t('Post settings')}</div>
          </div>
          <ChevronRight />
        </SettingItem>
      )}
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigateToSettings(toRssFeedSettings())}>
          <div className="flex items-center gap-4">
            <Rss />
            <div>{t('RSS Feed Settings')}</div>
          </div>
          <ChevronRight />
        </SettingItem>
      )}
      {!!nsec && (
        <SettingItem
          className="clickable"
          onClick={() => {
            navigator.clipboard.writeText(nsec)
            setCopiedNsec(true)
            setTimeout(() => setCopiedNsec(false), 2000)
          }}
        >
          <div className="flex items-center gap-4">
            <KeyRound />
            <div>{t('Copy private key')} (nsec)</div>
          </div>
          {copiedNsec ? <Check /> : <Copy />}
        </SettingItem>
      )}
      {!!ncryptsec && (
        <SettingItem
          className="clickable"
          onClick={() => {
            navigator.clipboard.writeText(ncryptsec)
            setCopiedNcryptsec(true)
            setTimeout(() => setCopiedNcryptsec(false), 2000)
          }}
        >
          <div className="flex items-center gap-4">
            <KeyRound />
            <div>{t('Copy private key')} (ncryptsec)</div>
          </div>
          {copiedNcryptsec ? <Check /> : <Copy />}
        </SettingItem>
      )}
      <AboutInfoDialog>
        <SettingItem className="clickable">
          <div className="flex items-center gap-4">
            <Info />
            <div>{t('About')}</div>
          </div>
          <div className="flex gap-2 items-center">
            <div className="text-muted-foreground">
              v{import.meta.env.APP_VERSION} ({import.meta.env.GIT_COMMIT})
            </div>
            <ChevronRight />
          </div>
        </SettingItem>
      </AboutInfoDialog>
      <div className="text-center py-6 text-muted-foreground">
        <div className="text-lg font-semibold">Jumble</div>
        <div className="text-green-600 dark:text-green-500 font-semibold">Im Wald</div>
      </div>
    </SecondaryPageLayout>
  )
})
SettingsPage.displayName = 'SettingsPage'
export default SettingsPage

const SettingItem = forwardRef<HTMLDivElement, HTMLProps<HTMLDivElement>>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        className={cn(
          'flex justify-between select-none items-center px-4 py-2 h-[52px] rounded-lg [&_svg]:size-4 [&_svg]:shrink-0',
          className
        )}
        {...props}
        ref={ref}
      >
        {children}
      </div>
    )
  }
)
SettingItem.displayName = 'SettingItem'
