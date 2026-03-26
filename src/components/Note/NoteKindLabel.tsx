import { cn } from '@/lib/utils'
import { getKindDescription } from '@/lib/kind-description'
import { useTranslation } from 'react-i18next'

export default function NoteKindLabel({
  kind,
  className,
  size = 'normal'
}: {
  kind: number
  className?: string
  size?: 'normal' | 'small'
}) {
  const { t } = useTranslation()
  const { description } = getKindDescription(kind)

  return (
    <p
      className={cn(
        'text-muted-foreground/80 select-none',
        size === 'small' ? 'text-[10px] leading-snug' : 'text-[11px] sm:text-xs leading-snug',
        className
      )}
      data-note-kind-label
    >
      {t('Note kind label line', { kind, description })}
    </p>
  )
}
