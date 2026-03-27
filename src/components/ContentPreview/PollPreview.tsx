import { POLL_TYPE } from '@/constants'
import { getPollMetadataFromEvent } from '@/lib/event-metadata'
import { parsePollOptionVisualParts } from '@/lib/poll-option-display'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import PollOptionContent from '@/components/Note/PollOptionContent'
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
          {poll.options.map((option) => {
            const optLabel = option.label || t('Option')
            const visual = parsePollOptionVisualParts(optLabel)
            const hasImg = visual.images.length > 0
            return (
            <div
              key={option.id}
              className={cn(
                'relative w-full px-4 py-3 rounded-lg border border-border bg-background flex gap-2 overflow-hidden',
                hasImg ? 'items-start' : 'items-center'
              )}
            >
              <div
                className={cn(
                  'flex min-h-0 gap-2 flex-1 w-0 z-10',
                  hasImg ? 'items-start pt-0.5' : 'items-center'
                )}
              >
                <PollOptionContent label={optLabel} visualParts={visual} textClassName="text-sm" />
              </div>
            </div>
            )
          })}
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
