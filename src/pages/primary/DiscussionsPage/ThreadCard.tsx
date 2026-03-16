import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, Hash, Users } from 'lucide-react'
import { NostrEvent } from 'nostr-tools'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { DISCUSSION_TOPICS } from './discussionTopics'
import Username from '@/components/Username'
import UserAvatar from '@/components/UserAvatar'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { extractAllTopics, extractGroupInfo } from '@/lib/discussion-topics'
import { removeEmojis } from '@/lib/utils'

interface ThreadCardProps {
  thread: NostrEvent
  onThreadClick: () => void
  className?: string
  lastCommentTime?: number
  lastVoteTime?: number
  upVotes?: number
  downVotes?: number
}

export default function ThreadCard({ 
  thread, 
  onThreadClick, 
  className,
  lastCommentTime = 0,
  lastVoteTime = 0,
  upVotes = 0,
  downVotes = 0
}: ThreadCardProps) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()

  // Extract title from tags and remove emojis
  const titleTag = thread.tags.find(tag => tag[0] === 'title' && tag[1])
  const rawTitle = titleTag?.[1] || t('Untitled')
  const title = removeEmojis(rawTitle) || t('Untitled')

  // Get topic info
  const topicTag = thread.tags.find(tag => tag[0] === 't' && tag[1])
  const topic = topicTag?.[1] || 'general'
  const topicInfo = DISCUSSION_TOPICS.find(t => t.id === topic) || { 
    id: topic, 
    label: topic, 
    icon: Hash
  }

  // Extract group information
  const groupInfo = extractGroupInfo(thread, ['unknown'])

  // Get all topics from this thread
  const allTopics = extractAllTopics(thread)

  // Format creation time (fromNow() includes suffix e.g. "3 hours ago")
  const timeAgo = dayjs.unix(thread.created_at).fromNow()

  // Format last activity times
  const formatLastActivity = (timestamp: number) => {
    if (timestamp === 0) return null
    return dayjs.unix(timestamp).fromNow()
  }
  
  const lastCommentAgo = formatLastActivity(lastCommentTime)
  const lastVoteAgo = formatLastActivity(lastVoteTime)
  
  // Vote counts are no longer displayed, keeping variables for potential future use
  
  // Get content preview - remove emojis first, then truncate
  const contentWithoutEmojis = removeEmojis(thread.content)
  const contentPreview = contentWithoutEmojis.length > 250 
    ? contentWithoutEmojis.substring(0, 250) + '...'
    : contentWithoutEmojis


  return (
    <Card 
      className={cn(
        'clickable hover:shadow-md transition-shadow cursor-pointer',
        className
      )}
      onClick={onThreadClick}
    >
      <CardHeader className="pb-3">
        {isSmallScreen ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center gap-1">
                <div className="text-green-600 font-semibold text-sm">+{upVotes || 0}</div>
                <div className="text-red-600 font-semibold text-sm">-{downVotes || 0}</div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg leading-tight line-clamp-2 mb-2 break-words">
                  {title}
                </h3>
                <div className="flex items-center flex-wrap gap-2 text-sm text-muted-foreground mb-2">
                  <div className="flex items-center gap-1">
                    <topicInfo.icon className="w-4 h-4" />
                    <span className="text-xs">{topicInfo.id}</span>
                  </div>
                  {allTopics.slice(0, 3).map(topic => (
                    <Badge key={topic} variant="outline" className="text-xs">
                      <Hash className="w-3 h-3 mr-1" />
                      {topic.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                    </Badge>
                  ))}
                </div>
                {groupInfo.isGroupDiscussion && groupInfo.groupDisplayName && (
                  <div className="mb-2">
                    <Badge variant="outline" className="text-xs">
                      <Users className="w-3 h-3 mr-1" />
                      {groupInfo.groupDisplayName}
                    </Badge>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <UserAvatar userId={thread.pubkey} size="xSmall" />
                  <Username 
                    userId={thread.pubkey} 
                    className="truncate font-medium"
                    skeletonClassName="h-4 w-20"
                  />
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>{timeAgo}</span>
                </div>
                
                {/* Last updated */}
                <div className="text-xs text-muted-foreground">
                  {t('last updated')}: {lastCommentAgo || lastVoteAgo || timeAgo}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1">
                <div className="text-green-600 font-semibold text-sm">+{upVotes || 0}</div>
                <div className="text-red-600 font-semibold text-sm">-{downVotes || 0}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-lg leading-tight line-clamp-2 break-words">
                    {title}
                  </h3>
                </div>
                <div className="flex items-center flex-wrap gap-2 text-sm text-muted-foreground mb-2">
                  <Badge variant="secondary" className="text-xs">
                    <topicInfo.icon className="w-3 h-3 mr-1" />
                    {topicInfo.label}
                  </Badge>
                  {allTopics.slice(0, 3).map(topic => (
                    <Badge key={topic} variant="outline" className="text-xs">
                      <Hash className="w-3 h-3 mr-1" />
                      {topic.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                    </Badge>
                  ))}
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {timeAgo}
                  </div>
                  
                  {/* Last updated */}
                  <div className="text-xs text-muted-foreground">
                    {t('last updated')}: {lastCommentAgo || lastVoteAgo || timeAgo}
                  </div>
                </div>
                {groupInfo.isGroupDiscussion && groupInfo.groupDisplayName && (
                  <div className="mb-2">
                    <Badge variant="outline" className="text-xs">
                      <Users className="w-3 h-3 mr-1" />
                      {groupInfo.groupDisplayName}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
              <UserAvatar userId={thread.pubkey} size="xSmall" />
              <Username 
                userId={thread.pubkey} 
                className="truncate font-medium"
                skeletonClassName="h-4 w-20"
              />
            </div>
          </div>
        )}
      </CardHeader>
      
      <CardContent className="pt-0">
        <div className="text-sm text-muted-foreground leading-relaxed break-words overflow-hidden">
          {contentPreview}
        </div>
      </CardContent>
    </Card>
  )
}
