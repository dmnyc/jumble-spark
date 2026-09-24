import { faviconUrlCandidates } from '@/lib/faviconUrl'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMemo, useState } from 'react'

export function Favicon({
  domain,
  className,
  fallback = null
}: {
  domain: string
  className?: string
  fallback?: React.ReactNode
}) {
  const { faviconUrlTemplate } = useContentPolicy()
  const candidates = useMemo(
    () => faviconUrlCandidates(faviconUrlTemplate, `https://${domain}`),
    [faviconUrlTemplate, domain]
  )
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [prevCandidates, setPrevCandidates] = useState(candidates)
  if (prevCandidates !== candidates) {
    setPrevCandidates(candidates)
    setCandidateIndex(0)
    setLoading(true)
  }
  if (candidateIndex >= candidates.length) return fallback

  return (
    <div className={cn('relative', className)}>
      {loading && <div className={cn('absolute inset-0', className)}>{fallback}</div>}
      <img
        src={candidates[candidateIndex]}
        alt={domain}
        className={cn('absolute inset-0', loading && 'opacity-0', className)}
        onError={() => setCandidateIndex((index) => index + 1)}
        onLoad={() => setLoading(false)}
      />
    </div>
  )
}
