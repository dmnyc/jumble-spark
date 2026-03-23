import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import { MessageCircle } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PostEditor from '../PostEditor'
import { formatCount } from './utils'

export default function ReplyButton({ event, hideCount = false }: { event: Event; hideCount?: boolean }) {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const noteStats = useNoteStatsById(event.id)
  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const { replyCount, hasReplied } = useMemo(() => {
    const hasReplied = pubkey
      ? noteStats?.replies?.some((reply) => reply.pubkey === pubkey)
      : false

    return {
      replyCount: hideUntrustedInteractions
        ? noteStats?.replies?.filter((reply) => isUserTrusted(reply.pubkey)).length ?? 0
        : noteStats?.replies?.length ?? 0,
      hasReplied
    }
  }, [noteStats, event.id, hideUntrustedInteractions, isUserTrusted, pubkey])
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className={cn(
          'flex gap-1 items-center enabled:hover:text-blue-400 pr-3 h-full',
          hasReplied ? 'text-blue-400' : 'text-muted-foreground'
        )}
        onClick={(e) => {
          e.stopPropagation()
          checkLogin(() => {
            setOpen(true)
          })
        }}
        title={t('Reply')}
      >
        <MessageCircle />
        {!hideCount && !!replyCount && <div className="text-sm">{formatCount(replyCount)}</div>}
      </button>
      <PostEditor parentEvent={event} open={open} setOpen={setOpen} />
    </>
  )
}
