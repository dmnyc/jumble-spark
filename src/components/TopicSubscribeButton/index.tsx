import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useInterestList } from '@/providers/interest-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { Bell, BellOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface TopicSubscribeButtonProps {
  topic: string
  variant?: 'default' | 'outline' | 'ghost' | 'icon'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  showLabel?: boolean
}

export default function TopicSubscribeButton({
  topic,
  variant = 'outline',
  size = 'sm',
  showLabel = true
}: TopicSubscribeButtonProps) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { isSubscribed, subscribe, unsubscribe, changing } = useInterestList()

  if (!pubkey) {
    return null
  }

  const subscribed = isSubscribed(topic)

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    
    if (changing) return

    if (subscribed) {
      await unsubscribe(topic)
    } else {
      await subscribe(topic)
    }
  }

  if (variant === 'icon' || !showLabel) {
    return (
      <Button
        variant={subscribed ? 'default' : 'outline'}
        size={size === 'icon' ? 'icon' : size}
        onClick={handleClick}
        disabled={changing}
        title={subscribed ? t('Unsubscribe') : t('Subscribe')}
      >
        {changing ? (
          <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />
        ) : subscribed ? (
          <Bell className="h-4 w-4" fill="currentColor" />
        ) : (
          <BellOff className="h-4 w-4" />
        )}
      </Button>
    )
  }

  return (
    <Button
      variant={subscribed ? 'default' : variant}
      size={size}
      onClick={handleClick}
      disabled={changing}
      className="flex items-center gap-2"
    >
      {changing ? (
        <>
          <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />
          {subscribed ? t('Unsubscribing...') : t('Subscribing...')}
        </>
      ) : subscribed ? (
        <>
          <Bell className="h-4 w-4" fill="currentColor" />
          {t('Subscribed')}
        </>
      ) : (
        <>
          <BellOff className="h-4 w-4" />
          {t('Subscribe')}
        </>
      )}
    </Button>
  )
}

