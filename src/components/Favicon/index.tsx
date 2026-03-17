import { cn } from '@/lib/utils'
import { useState } from 'react'

export function Favicon({
  domain,
  className,
  fallback = null
}: {
  domain: string
  className?: string
  fallback?: React.ReactNode
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const trimmed = domain?.trim() ?? ''
  if (error || !trimmed) return fallback

  return (
    <div className={cn('relative', className)}>
      {loading && <div className={cn('absolute inset-0', className)}>{fallback}</div>}
      <img
        src={`https://${trimmed}/favicon.ico`}
        alt={trimmed}
        className={cn('absolute inset-0', loading && 'opacity-0', className)}
        onError={() => setError(true)}
        onLoad={() => setLoading(false)}
      />
    </div>
  )
}
