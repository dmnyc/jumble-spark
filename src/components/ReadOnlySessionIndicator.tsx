import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useTranslation } from 'react-i18next'

type TVariant = 'sidebar' | 'titlebar'

export function ReadOnlySessionIndicator({ variant }: { variant: TVariant }) {
  const { t } = useTranslation()
  const { account } = useNostr()
  if (account?.signerType !== 'npub') return null

  const hint = t('readOnlySession.hint')

  if (variant === 'sidebar') {
    return (
      <div
        role="status"
        title={hint}
        className={cn(
          'mb-1 w-full px-0.5 text-center text-[10px] font-medium uppercase tracking-wide',
          'text-muted-foreground/85'
        )}
      >
        <span className="max-xl:hidden">{t('readOnlySession.label')}</span>
        <span className="xl:hidden" aria-label={t('readOnlySession.label')}>
          {t('readOnlySession.labelShort')}
        </span>
      </div>
    )
  }

  return (
    <span
      role="status"
      title={hint}
      className="shrink-0 rounded border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/90"
    >
      {t('readOnlySession.label')}
    </span>
  )
}
