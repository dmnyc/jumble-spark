import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useFetchRelayInfo } from '@/hooks'
import { cn } from '@/lib/utils'
import { Server } from 'lucide-react'
import { useMemo } from 'react'

export default function RelayIcon({
  url,
  className,
  iconSize = 14
}: {
  url?: string
  className?: string
  iconSize?: number
}) {
  const { relayInfo } = useFetchRelayInfo(url)
  const iconUrl = useMemo(() => {
    if (relayInfo?.icon && typeof relayInfo.icon === 'string' && relayInfo.icon.startsWith('http')) {
      return relayInfo.icon
    }
    if (!url) return undefined
    try {
      const u = new URL(url)
      const href = `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}/favicon.ico`
      return href
    } catch {
      return undefined
    }
  }, [url, relayInfo])

  return (
    <Avatar className={cn('w-6 h-6', className)}>
      {iconUrl && <AvatarImage src={iconUrl} className="object-cover object-center" />}
      <AvatarFallback>
        <Server size={iconSize} />
      </AvatarFallback>
    </Avatar>
  )
}
