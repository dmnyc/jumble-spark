import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { createHttpRelayListDraftEvent } from '@/lib/draft-event'
import { showPublishingFeedback, showSimplePublishSuccess, showPublishingError } from '@/lib/publishing-feedback'
import { useNostr } from '@/providers/NostrProvider'
import { TMailboxRelay } from '@/types'
import { CloudUpload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import logger from '@/lib/logger'

export default function SaveButton({
  mailboxRelays,
  hasChange,
  setHasChange
}: {
  mailboxRelays: TMailboxRelay[]
  hasChange: boolean
  setHasChange: (hasChange: boolean) => void
}) {
  const { t } = useTranslation()
  const { pubkey, publish, updateHttpRelayListEvent } = useNostr()
  const [pushing, setPushing] = useState(false)

  const save = async () => {
    if (!pubkey) return

    setPushing(true)
    try {
      const event = createHttpRelayListDraftEvent(mailboxRelays)
      const result = await publish(event)

      const relayStatuses = (result as any).relayStatuses

      await updateHttpRelayListEvent(result)
      setHasChange(false)

      if (relayStatuses && relayStatuses.length > 0) {
        showPublishingFeedback(
          {
            success: true,
            relayStatuses: relayStatuses,
            successCount: relayStatuses.filter((s: any) => s.success).length,
            totalCount: relayStatuses.length
          },
          {
            message: t('HTTP relays saved'),
            duration: 6000
          }
        )
      } else {
        showSimplePublishSuccess(t('HTTP relays saved'))
      }
    } catch (error) {
      logger.error('Failed to save HTTP relay list', { error })
      if (error instanceof Error && (error as any).relayStatuses) {
        const errorRelayStatuses = (error as any).relayStatuses
        showPublishingFeedback(
          {
            success: false,
            relayStatuses: errorRelayStatuses,
            successCount: errorRelayStatuses.filter((s: any) => s.success).length,
            totalCount: errorRelayStatuses.length
          },
          {
            message: error.message || t('Failed to save HTTP relay list'),
            duration: 6000
          }
        )
      } else {
        showPublishingError(error instanceof Error ? error : new Error(t('Failed to save HTTP relay list')))
      }
    } finally {
      setPushing(false)
    }
  }

  return (
    <Button className="w-full" disabled={!pubkey || pushing || !hasChange} onClick={save}>
      {pushing ? <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden /> : <CloudUpload />}
      {t('Save')}
    </Button>
  )
}
