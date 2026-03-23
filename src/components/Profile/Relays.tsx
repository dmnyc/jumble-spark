import { useFetchRelayList } from '@/hooks'
import { toOthersRelaySettings, toRelaySettings } from '@/lib/link'
import { SecondaryPageLink } from '@/PageManager'
import { Skeleton } from '@/components/ui/skeleton'
import { useNostr } from '@/providers/NostrProvider'
import { useTranslation } from 'react-i18next'

export default function Relays({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey } = useNostr()
  const { relayList, isFetching } = useFetchRelayList(pubkey)

  return (
    <SecondaryPageLink
      to={accountPubkey === pubkey ? toRelaySettings('mailbox') : toOthersRelaySettings(pubkey)}
      className="flex gap-1 hover:underline w-fit items-center"
    >
      {isFetching ? <Skeleton className="inline-block size-4 shrink-0 rounded-sm" aria-hidden /> : relayList.originalRelays.length}
      <div className="text-muted-foreground">{t('Relays')}</div>
    </SecondaryPageLink>
  )
}
