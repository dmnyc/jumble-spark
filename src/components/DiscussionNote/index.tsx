import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { MessageCircle, Hash, Users } from 'lucide-react'
import { Event } from 'nostr-tools'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { DISCUSSION_TOPICS } from '@/pages/primary/DiscussionsPage/discussionTopics'
import { extractGroupInfo } from '@/lib/discussion-topics'

interface DiscussionNoteProps {
  event: Event
  className?: string
  size?: 'normal' | 'small'
}

export default function DiscussionNote({ event, className, size = 'normal' }: DiscussionNoteProps) {
  const { t } = useTranslation()
  
  // Extract title and topic from tags
  const titleTag = event.tags.find(tag => tag[0] === 'title')
  const topicTag = event.tags.find(tag => tag[0] === 't')
  const title = titleTag?.[1] || 'Untitled Discussion'
  const topic = topicTag?.[1] || 'general'
  
  // Extract group information
  const groupInfo = extractGroupInfo(event, ['unknown'])
  
  // Get topic info
  const topicInfo = DISCUSSION_TOPICS.find(t => t.id === topic) || { 
    id: topic, 
    label: topic, 
    icon: Hash
  }

  const isSmall = size === 'small'

  return (
    <Card className={cn('border-l-4 border-l-blue-500', className)}>
      <CardContent className={cn('p-4', isSmall && 'p-3')}>
        <div className="flex items-start gap-3">
          <div className={cn('flex-shrink-0', isSmall && 'mt-1')}>
            <MessageCircle className={cn('text-blue-500', isSmall ? 'w-4 h-4' : 'w-5 h-5')} />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="text-xs">
                <topicInfo.icon className="w-3 h-3 mr-1" />
                {topicInfo.label}
              </Badge>
              {groupInfo.isGroupDiscussion && groupInfo.groupDisplayName && (
                <Badge variant="outline" className="text-xs">
                  <Users className="w-3 h-3 mr-1" />
                  {groupInfo.groupDisplayName}
                </Badge>
              )}
              <span className={cn('text-xs text-muted-foreground', isSmall && 'text-xs')}>
                {t('Discussion')}
              </span>
            </div>
            
            <h3 className={cn(
              'font-semibold leading-tight mb-2 line-clamp-2',
              isSmall ? 'text-sm' : 'text-base'
            )}>
              {title}
            </h3>
            
            <div className={cn(
              'text-muted-foreground line-clamp-3',
              isSmall ? 'text-sm' : 'text-sm'
            )}>
              {event.content}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
