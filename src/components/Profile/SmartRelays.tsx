import { useFetchRelayList } from '@/hooks'
import { toOthersRelaySettings } from '@/lib/link'
import { useSmartOthersRelaySettingsNavigation } from '@/PageManager'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from 'react-i18next'

export default function SmartRelays({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { relayList, isFetching } = useFetchRelayList(pubkey)
  const { navigateToOthersRelaySettings } = useSmartOthersRelaySettingsNavigation()

  const handleClick = () => {
    // Navigate to the page showing this user's used relays
    navigateToOthersRelaySettings(toOthersRelaySettings(pubkey))
  }

  return (
    <span
      className="flex gap-1 hover:underline w-fit items-center cursor-pointer"
      onClick={handleClick}
    >
      {isFetching ? <Skeleton className="inline-block size-4 shrink-0 rounded-sm" aria-hidden /> : relayList.originalRelays.length}
      <div className="text-muted-foreground">{t('Relays')}</div>
    </span>
  )
}
