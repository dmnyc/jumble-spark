import { POLL_TYPE } from '@/constants'
import { getPollMetadataFromEvent } from '@/lib/event-metadata'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Content from './Content'

export default function PollPreview({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const emojiInfos = useMemo(() => getEmojiInfosFromEmojiTags(event.tags), [event])
  const poll = useMemo(() => getPollMetadataFromEvent(event), [event])
  const content = event.content?.trim()

  return (
    <div className={cn('pointer-events-none', className)}>
      <div className="flex items-center gap-1 mb-1">
        <span className="text-muted-foreground">[{t('Poll')}]</span>
        {poll?.pollType === POLL_TYPE.MULTIPLE_CHOICE && (
          <span className="text-xs text-muted-foreground">({t('Multiple choice')})</span>
        )}
      </div>
      {content ? (
        <div className="mb-1">
          <Content
            content={content}
            emojiInfos={emojiInfos}
            className="italic pr-0.5"
          />
        </div>
      ) : null}
      {poll && poll.options.length > 0 ? (
        <div className="grid gap-2">
          {poll.options.map((option) => (
            <div
              key={option.id}
              className="relative w-full px-4 py-3 rounded-lg border border-border bg-background flex items-center gap-2 overflow-hidden"
            >
              <div className="flex items-center gap-2 flex-1 w-0 z-10">
                <div className="line-clamp-2 text-left text-sm">
                  {option.label || t('Option')}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : poll ? (
        <div className="text-sm text-muted-foreground italic">
          {t('Poll with no options')}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground italic">
          {content || t('Poll')}
        </div>
      )}
    </div>
  )
}
