import { Button } from '@/components/ui/button'
import { createReactionDraftEvent } from '@/lib/draft-event'
import { useNostr } from '@/providers/NostrProvider'
import noteStatsService from '@/services/note-stats.service'
import { Event } from 'nostr-tools'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import logger from '@/lib/logger'
import { showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import { useTranslation } from 'react-i18next'

export default function VoteButtons({ event }: { event: Event }) {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin } = useNostr()
  const [voting, setVoting] = useState<string | null>(null)
  const noteStats = useNoteStatsById(event.id)

  // Calculate vote counts and user's current vote
  const { userVote, score } = useMemo(() => {
    const stats = noteStats || {}
    const reactions = stats.likes || []
    
    const upvoteReactions = reactions.filter(r => r.emoji === '⬆️')
    const downvoteReactions = reactions.filter(r => r.emoji === '⬇️')
    
    const score = upvoteReactions.length - downvoteReactions.length
    
    // Check if current user has voted
    let userVote: 'up' | 'down' | null = null
    if (pubkey) {
      if (upvoteReactions.some(r => r.pubkey === pubkey)) {
        userVote = 'up'
      } else if (downvoteReactions.some(r => r.pubkey === pubkey)) {
        userVote = 'down'
      }
    }
    
    return { userVote, score }
  }, [noteStats, pubkey])

  const vote = async (type: 'up' | 'down') => {
    checkLogin(async () => {
      if (voting || !pubkey) return

      // Prevent voting if user already voted (no toggling allowed)
      if (userVote) {
        return // User already voted, don't allow multiple votes
      }

      setVoting(type)
      const timer = setTimeout(() => setVoting(null), 10_000)

      try {
        if (!noteStats?.updatedAt) {
          await noteStatsService.fetchNoteStats(event, pubkey)
        }

        // Create the vote reaction
        const emoji = type === 'up' ? '⬆️' : '⬇️'
        
        // Check if user already voted this way
        const existingVote = userVote === type
        if (existingVote) {
          // Remove vote by creating a reaction with the same emoji (this will toggle it off)
          const reaction = createReactionDraftEvent(event, emoji)
          const evt = await publish(reaction)
          
          // Show publishing feedback
          if ((evt as any)?.relayStatuses) {
            showPublishingFeedback({
              success: true,
              relayStatuses: (evt as any).relayStatuses,
              successCount: (evt as any).relayStatuses.filter((s: any) => s.success).length,
              totalCount: (evt as any).relayStatuses.length
            }, {
              message: t('Vote removed'),
              duration: 4000
            })
          } else {
            showSimplePublishSuccess(t('Vote removed'))
          }
          
          noteStatsService.updateNoteStatsByEvents([evt])
        } else {
          // If user voted the opposite way, first remove the old vote
          if (userVote) {
            const oldEmoji = userVote === 'up' ? '⬆️' : '⬇️'
            const removeReaction = createReactionDraftEvent(event, oldEmoji)
            await publish(removeReaction)
          }
          
          // Then add the new vote
          const reaction = createReactionDraftEvent(event, emoji)
          const evt = await publish(reaction)
          
          // Show publishing feedback
          if ((evt as any)?.relayStatuses) {
            showPublishingFeedback({
              success: true,
              relayStatuses: (evt as any).relayStatuses,
              successCount: (evt as any).relayStatuses.filter((s: any) => s.success).length,
              totalCount: (evt as any).relayStatuses.length
            }, {
              message: t('Vote published'),
              duration: 4000
            })
          } else {
            showSimplePublishSuccess(t('Vote published'))
          }
          
          noteStatsService.updateNoteStatsByEvents([evt])
        }
      } catch (error) {
        logger.error('Vote failed', { error, eventId: event.id })
      } finally {
        setVoting(null)
        clearTimeout(timer)
      }
    })
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className={`h-6 w-6 p-0 hover:bg-muted hover:text-foreground ${
          userVote === 'up' ? 'bg-muted text-foreground' : 'text-muted-foreground'
        }`}
        onClick={() => vote('up')}
        disabled={voting !== null || userVote !== null}
      >
        <ChevronUp className={`h-4 w-4 ${userVote === 'up' ? 'font-bold stroke-2 text-foreground' : ''}`} />
      </Button>
      
      <span className={`text-xs font-medium min-w-[20px] text-center ${
        score > 0 ? 'text-green-600' : score < 0 ? 'text-red-600' : 'text-muted-foreground'
      }`}>
        {score}
      </span>
      
      <Button
        variant="ghost"
        size="sm"
        className={`h-6 w-6 p-0 hover:bg-muted hover:text-foreground ${
          userVote === 'down' ? 'bg-muted text-foreground' : 'text-muted-foreground'
        }`}
        onClick={() => vote('down')}
        disabled={voting !== null || userVote !== null}
      >
        <ChevronDown className={`h-4 w-4 ${userVote === 'down' ? 'font-bold stroke-2 text-foreground' : ''}`} />
      </Button>
    </div>
  )
}
