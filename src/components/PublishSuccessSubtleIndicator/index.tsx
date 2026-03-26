import { PUBLISH_SUCCESS_SUBTLE_EVENT, type PublishSuccessSubtleDetail } from '@/lib/publishing-feedback'
import { cn } from '@/lib/utils'
import { CheckCircle2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * When publish success toasts are off, {@link emitPublishSuccessSubtle} shows this instead:
 * small green check + label, bottom-right, auto-dismiss.
 */
export default function PublishSuccessSubtleIndicator() {
  const { t } = useTranslation()
  const [payload, setPayload] = useState<{ message: string } | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PublishSuccessSubtleDetail>).detail
      const raw = detail?.message?.trim()
      const message = raw && raw.length > 0 ? raw : t('Publish successful')
      if (hideTimerRef.current != null) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
      setPayload({ message })
      hideTimerRef.current = setTimeout(() => {
        setPayload(null)
        hideTimerRef.current = null
      }, 3200)
    }
    window.addEventListener(PUBLISH_SUCCESS_SUBTLE_EVENT, handler)
    return () => {
      window.removeEventListener(PUBLISH_SUCCESS_SUBTLE_EVENT, handler)
      if (hideTimerRef.current != null) clearTimeout(hideTimerRef.current)
    }
  }, [t])

  if (!payload) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'pointer-events-none fixed bottom-4 right-4 z-[55] flex max-w-[min(90vw,18rem)] items-center gap-2 rounded-lg border border-border',
        'bg-background/95 px-3 py-2 text-sm text-foreground shadow-md backdrop-blur-sm',
        'animate-in fade-in slide-in-from-bottom-2 duration-200'
      )}
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-500" aria-hidden />
      <span className="min-w-0 leading-snug">{payload.message}</span>
    </div>
  )
}
