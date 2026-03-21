import { Event, nip19 } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import logger from '@/lib/logger'
import { cn } from '@/lib/utils'
import { isRssThreadSyntheticParentEvent } from '@/lib/rss-article'
import { isValidPubkey } from '@/lib/pubkey'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'

function isAllZeroPlaceholderPubkey(pk: string): boolean {
  return isValidPubkey(pk) && /^0+$/.test(pk)
}

export default function EventViewer({
  event,
  className,
  /** When true, `event.tags` and nested tag rows render expanded (no collapse). */
  expandTagsTree = false
}: {
  event: Event
  className?: string
  expandTagsTree?: boolean
}) {
  const { t } = useTranslation()
  const [copiedJson, setCopiedJson] = useState(false)
  const [copiedNevent, setCopiedNevent] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const nevent = useMemo(
    () => nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind }),
    [event.id, event.pubkey, event.kind]
  )

  const setKeyExpanded = (key: string, open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(event, null, 2))
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

  const renderValue = (value: unknown, key: string, depth = 0): React.ReactNode => {
    if (value === null) {
      return <span className="text-muted-foreground">null</span>
    }
    if (value === undefined) {
      return <span className="text-muted-foreground">undefined</span>
    }
    if (typeof value === 'string') {
      return <span className="text-green-600 dark:text-green-400">"{value}"</span>
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return <span className="text-blue-600 dark:text-blue-400">{String(value)}</span>
    }
    if (Array.isArray(value)) {
      const tagsTreeAlwaysOpen =
        expandTagsTree && (key === 'tags' || key.startsWith('tags['))
      if (tagsTreeAlwaysOpen) {
        return (
          <div className={cn('ml-2', depth > 0 && 'border-l border-border/50 pl-2')}>
            <div className="text-xs text-muted-foreground mb-1">
              Array ({value.length})
            </div>
            <div className="ml-4">
              {value.map((item, idx) => (
                <div key={idx} className="mb-1">
                  <span className="text-muted-foreground text-xs">[{idx}]</span>{' '}
                  {renderValue(item, `${key}[${idx}]`, depth + 1)}
                </div>
              ))}
            </div>
          </div>
        )
      }
      const isExpanded = expanded.has(key)
      return (
        <div className={cn('ml-2', depth > 0 && 'border-l border-border/50 pl-2')}>
          <Collapsible
            open={isExpanded}
            onOpenChange={(open) => setKeyExpanded(key, open)}
          >
            <CollapsibleTrigger
              type="button"
              className="flex items-center gap-1 text-sm hover:text-foreground"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span className="text-muted-foreground">Array</span>
              <span className="text-xs text-muted-foreground">({value.length})</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 ml-4">
              {value.map((item, idx) => (
                <div key={idx} className="mb-1">
                  <span className="text-muted-foreground text-xs">[{idx}]</span>{' '}
                  {renderValue(item, `${key}[${idx}]`, depth + 1)}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )
    }
    if (typeof value === 'object') {
      const isExpanded = expanded.has(key)
      const entries = Object.entries(value)
      return (
        <div className={cn('ml-2', depth > 0 && 'border-l border-border/50 pl-2')}>
          <Collapsible
            open={isExpanded}
            onOpenChange={(open) => setKeyExpanded(key, open)}
          >
            <CollapsibleTrigger
              type="button"
              className="flex items-center gap-1 text-sm hover:text-foreground"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span className="text-muted-foreground">Object</span>
              <span className="text-xs text-muted-foreground">({entries.length} keys)</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 ml-4">
              {entries.map(([k, v]) => (
                <div key={k} className="mb-1">
                  <span className="text-purple-600 dark:text-purple-400 font-medium">"{k}"</span>:{' '}
                  {renderValue(v, `${key}.${k}`, depth + 1)}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )
    }
    return <span className="text-muted-foreground">{String(value)}</span>
  }

  const createdAtFormatted = dayjs(event.created_at * 1000).format('LLL')
  const pubkey = event.pubkey ?? ''
  const hidePubkeyRow = isRssThreadSyntheticParentEvent(event)
  const showAuthorBadge =
    !hidePubkeyRow && isValidPubkey(pubkey) && !isAllZeroPlaceholderPubkey(pubkey)

  return (
    <div className={cn('border rounded-lg p-4 bg-muted/30', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">Event (kind {event.kind})</div>
        <Button variant="ghost" size="sm" onClick={handleCopyJson} className="h-7">
          {copiedJson ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <div className="text-sm space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-purple-600 dark:text-purple-400 font-medium shrink-0">nevent</span>
          <code className="truncate text-green-600 dark:text-green-400 text-xs">{nevent}</code>
          <Button variant="ghost" size="sm" onClick={handleCopyNevent} className="h-6 w-6 p-0 shrink-0">
            {copiedNevent ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
        {!hidePubkeyRow && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-purple-600 dark:text-purple-400 font-medium shrink-0">pubkey</span>
            {showAuthorBadge ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <UserAvatar userId={pubkey} size="xSmall" />
                <Username
                  userId={pubkey}
                  className="font-normal min-w-0"
                  skeletonClassName="h-4"
                  withoutSkeleton
                />
              </div>
            ) : (
              <span className="text-muted-foreground text-xs break-all">
                {!pubkey
                  ? t('Missing pubkey')
                  : isAllZeroPlaceholderPubkey(pubkey)
                    ? t('Synthetic event (no author)')
                    : pubkey}
              </span>
            )}
          </div>
        )}
        <div>
          <span className="text-purple-600 dark:text-purple-400 font-medium">kind</span>{' '}
          {renderValue(event.kind, 'kind')}
        </div>
        <div>
          <span className="text-purple-600 dark:text-purple-400 font-medium">created_at</span>{' '}
          <span className="text-muted-foreground">{createdAtFormatted}</span>
        </div>
        <div className="font-mono">
          <span className="text-purple-600 dark:text-purple-400 font-medium">tags</span>{' '}
          {renderValue(event.tags, 'tags')}
        </div>
        <div className="font-mono">
          <span className="text-purple-600 dark:text-purple-400 font-medium">content</span>{' '}
          {renderValue(event.content, 'content')}
        </div>
      </div>
    </div>
  )
}
