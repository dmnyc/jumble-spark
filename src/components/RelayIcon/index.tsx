import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useFetchRelayInfo } from '@/hooks'
import { cn } from '@/lib/utils'
import logger from '@/lib/logger'
import { Server } from 'lucide-react'
import { useMemo } from 'react'

/**
 * Resolve an image URL from NIP-11.  Handles:
 * - Absolute HTTP(S) URLs → used as-is
 * - Relative paths (e.g. "/favicon.ico") → resolved against the relay's base HTTP URL
 * - ws(s):// URLs some relays mistakenly return → ignored, fall through to favicon
 */
function resolveRelayImageUrl(raw: string, relayUrl: string): string | undefined {
  if (!raw) return undefined
  if (raw.startsWith('https://') || raw.startsWith('http://')) return raw
  if (raw.startsWith('/')) {
    try {
      const base = relayUrl.replace(/^wss?:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://')
      const u = new URL(base)
      return `${u.protocol}//${u.host}${raw}`
    } catch {
      return undefined
    }
  }
  return undefined
}

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
    if (!url) return undefined

    // Prefer the NIP-11 icon field
    const rawIcon = relayInfo?.icon && typeof relayInfo.icon === 'string' ? relayInfo.icon : undefined
    const nip11Icon = rawIcon ? resolveRelayImageUrl(rawIcon, url) : undefined
    if (nip11Icon) {
      logger.debug('[RelayIcon] using NIP-11 icon', { url, rawIcon, nip11Icon })
      return nip11Icon
    }

    // Fall back to /favicon.ico at the relay's host
    try {
      const u = new URL(url)
      const scheme = u.protocol === 'wss:' ? 'https:' : 'http:'
      const favicon = `${scheme}//${u.host}/favicon.ico`
      logger.debug('[RelayIcon] using favicon fallback', { url, rawIcon, favicon })
      return favicon
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
