import { Button } from '@/components/ui/button'
import { createRelayListDraftEvent } from '@/lib/draft-event'
import { showPublishingFeedback, showSimplePublishSuccess, showPublishingError } from '@/lib/publishing-feedback'
import { useNostr } from '@/providers/NostrProvider'
import { TMailboxRelay } from '@/types'
import { CloudUpload, Loader } from 'lucide-react'
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
  const { pubkey, publish, updateRelayListEvent } = useNostr()
  const [pushing, setPushing] = useState(false)

  const save = async () => {
    if (!pubkey) return

    setPushing(true)
    try {
      const event = createRelayListDraftEvent(mailboxRelays)
      const result = await publish(event)
      
      // Read relayStatuses immediately before it might be deleted
      const relayStatuses = (result as any).relayStatuses
      
      await updateRelayListEvent(result)
      setHasChange(false)
      
      // Show publishing feedback
      if (relayStatuses && relayStatuses.length > 0) {
        showPublishingFeedback({
          success: true,
          relayStatuses: relayStatuses,
          successCount: relayStatuses.filter((s: any) => s.success).length,
          totalCount: relayStatuses.length
        }, {
          message: t('Mailbox relays saved'),
          duration: 6000
        })
      } else {
        showSimplePublishSuccess(t('Mailbox relays saved'))
      }
    } catch (error) {
      logger.error('Failed to save relay list', { error })
      // Show error feedback with relay statuses if available
      if (error instanceof Error && (error as any).relayStatuses) {
        const errorRelayStatuses = (error as any).relayStatuses
        showPublishingFeedback({
          success: false,
          relayStatuses: errorRelayStatuses,
          successCount: errorRelayStatuses.filter((s: any) => s.success).length,
          totalCount: errorRelayStatuses.length
        }, {
          message: error.message || t('Failed to save relay list'),
          duration: 6000
        })
      } else {
        showPublishingError(error instanceof Error ? error : new Error(t('Failed to save relay list')))
      }
    } finally {
      setPushing(false)
    }
  }

  return (
    <Button className="w-full" disabled={!pubkey || pushing || !hasChange} onClick={save}>
      {pushing ? <Loader className="animate-spin" /> : <CloudUpload />}
      {t('Save')}
    </Button>
  )
}
