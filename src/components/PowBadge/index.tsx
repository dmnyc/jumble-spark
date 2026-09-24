import { cn } from '@/lib/utils'
import { Event, nip13 } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export default function PowBadge({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const difficulty = useMemo(() => {
    if (!event.tags.some(([name]) => name === 'nonce')) return 0
    if (!/^[0-9a-f]{64}$/i.test(event.id)) return 0
    return nip13.getPow(event.id)
  }, [event])

  if (!difficulty) return null

  return (
    <span
      className={cn(
        'bg-muted/60 text-muted-foreground/70 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] leading-none',
        className
      )}
      title={t('Proof of Work (difficulty {{minPow}})', { minPow: difficulty })}
    >
      PoW {difficulty}
    </span>
  )
}
