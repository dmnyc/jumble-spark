import { getPubkeysFromPTags } from '@/lib/tag'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SimpleUserAvatar } from '../UserAvatar'
import { Users, ExternalLink } from 'lucide-react'
import { Button } from '../ui/button'
import { toFollowPacks } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'

export default function FollowPackPreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  
  const packPubkeys = useMemo(() => getPubkeysFromPTags(event.tags), [event.tags])
  
  const getPackTitle = (pack: Event): string => {
    const titleTag = pack.tags.find(tag => tag[0] === 'title' || tag[0] === 'name')
    return titleTag?.[1] || t('Follow Pack')
  }

  const getPackDescription = (pack: Event): string => {
    const descTag = pack.tags.find(tag => tag[0] === 'description' || tag[0] === 'd')
    return descTag?.[1] || ''
  }

  const title = getPackTitle(event)
  const description = getPackDescription(event)

  const handleOpenInViewer = (e: React.MouseEvent) => {
    e.stopPropagation()
    push(toFollowPacks())
  }

  return (
    <div className={cn('border rounded-lg p-3 bg-muted/30', className)}>
      <div className="flex items-center gap-1 mb-2">
        <span className="text-muted-foreground">[{t('Follow Pack')}]</span>
        <span className="font-semibold text-sm">{title}</span>
      </div>
      
      {description && (
        <div className="text-sm text-muted-foreground mb-3 line-clamp-2">
          {description}
        </div>
      )}
      
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4" />
          <span>{t('{{count}} profiles', { count: packPubkeys.length })}</span>
        </div>
        
        {packPubkeys.length > 0 && (
          <div className="flex -space-x-2">
            {packPubkeys.slice(0, 5).map((pubkey) => (
              <SimpleUserAvatar 
                key={pubkey} 
                userId={pubkey} 
                size="small" 
                className="border-2 border-background"
              />
            ))}
            {packPubkeys.length > 5 && (
              <div className="size-7 rounded-full border-2 border-background bg-muted flex items-center justify-center text-xs text-muted-foreground">
                +{packPubkeys.length - 5}
              </div>
            )}
          </div>
        )}
      </div>
      
      <Button
        variant="outline"
        size="sm"
        onClick={handleOpenInViewer}
        className="w-full"
      >
        <ExternalLink className="size-4 mr-2" />
        {t('Open in Follow Pack Viewer')}
      </Button>
    </div>
  )
}

