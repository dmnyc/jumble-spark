import { Event, nip19 } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import logger from '@/lib/logger'
import { cn } from '@/lib/utils'
import { isRssThreadSyntheticParentEvent } from '@/lib/rss-article'
import { isValidPubkey } from '@/lib/pubkey'
import { getKindDescription } from '@/lib/kind-description'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'

function isAllZeroPlaceholderPubkey(pk: string): boolean {
  return isValidPubkey(pk) && /^0+$/.test(pk)
}

export default function EventViewer({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const [copiedJson, setCopiedJson] = useState(false)
  const [copiedNevent, setCopiedNevent] = useState(false)

  const nevent = useMemo(
    () => nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind }),
    [event.id, event.pubkey, event.kind]
  )

  const jsonPretty = useMemo(() => JSON.stringify(event, null, 2), [event])

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonPretty)
      setCopiedJson(true)
      toast.success(t('Copied to clipboard'))
      setTimeout(() => setCopiedJson(false), 2000)
    } catch (err) {
      logger.error('Failed to copy event JSON', { error: err, eventId: event.id })
      toast.error(t('Failed to copy'))
    }
  }

  const handleCopyNevent = async () => {
    try {
      await navigator.clipboard.writeText(nevent)
      setCopiedNevent(true)
      toast.success(t('Copied to clipboard'))
      setTimeout(() => setCopiedNevent(false), 2000)
    } catch (err) {
      logger.error('Failed to copy nevent', { error: err })
      toast.error(t('Failed to copy'))
    }
  }

  const createdAtFormatted = dayjs(event.created_at * 1000).format('LLL')
  const pubkey = event.pubkey ?? ''
  const hidePubkeyRow = isRssThreadSyntheticParentEvent(event)
  const showAuthorBadge =
    !hidePubkeyRow && isValidPubkey(pubkey) && !isAllZeroPlaceholderPubkey(pubkey)
  const kindLabel = getKindDescription(event.kind)

  return (
    <div className={cn('rounded-lg border border-border bg-muted/20 p-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 pb-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{kindLabel.description}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t('Event kind and time', { kind: event.kind, time: createdAtFormatted })}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleCopyJson} className="h-8 shrink-0 gap-1.5">
          {copiedJson ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {t('Copy JSON')}
        </Button>
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 font-medium text-muted-foreground">{t('nevent')}</span>
          <code className="min-w-0 flex-1 truncate rounded bg-muted/80 px-2 py-0.5 font-mono text-xs text-foreground">
            {nevent}
          </code>
          <Button variant="ghost" size="sm" onClick={handleCopyNevent} className="h-7 w-7 shrink-0 p-0">
            {copiedNevent ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        {!hidePubkeyRow && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 font-medium text-muted-foreground">{t('Author')}</span>
            {showAuthorBadge ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <UserAvatar userId={pubkey} size="xSmall" />
                <Username
                  userId={pubkey}
                  className="min-w-0 font-normal"
                  skeletonClassName="h-4"
                  withoutSkeleton
                />
              </div>
            ) : (
              <span className="break-all text-xs text-muted-foreground">
                {!pubkey
                  ? t('Missing pubkey')
                  : isAllZeroPlaceholderPubkey(pubkey)
                    ? t('Synthetic event (no author)')
                    : pubkey}
              </span>
            )}
          </div>
        )}
      </div>

      <pre className="mt-4 max-h-[min(50vh,28rem)] overflow-auto rounded-md border border-border/80 bg-background/90 p-3 font-mono text-xs leading-relaxed text-foreground">
        {jsonPretty}
      </pre>
    </div>
  )
}
