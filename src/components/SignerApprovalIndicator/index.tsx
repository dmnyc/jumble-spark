import {
  dismissSignerApproval,
  getSignerApprovalSnapshot,
  subscribeToSignerApproval
} from '@/lib/signer-approval'
import { cn } from '@/lib/utils'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Loader2, X } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

function useSignerApprovalVisible() {
  return useSyncExternalStore(
    subscribeToSignerApproval,
    getSignerApprovalSnapshot,
    getSignerApprovalSnapshot
  )
}

export function MobileSignerApprovalIndicator() {
  const { isSmallScreen } = useScreenSize()
  const visible = useSignerApprovalVisible()

  if (!isSmallScreen || !visible) return null

  return (
    <div className="pointer-events-none fixed inset-x-14 top-[calc(env(safe-area-inset-top)+0.375rem)] z-50 flex h-9 justify-center">
      <SignerApprovalContent className="bg-secondary text-secondary-foreground pointer-events-auto max-w-full rounded-full ps-3 pe-1 shadow-md" />
    </div>
  )
}

export function SidebarSignerApprovalIndicator({ collapsed }: { collapsed: boolean }) {
  const visible = useSignerApprovalVisible()
  const { t } = useTranslation()

  if (!visible) return null

  if (collapsed) {
    return (
      <button
        type="button"
        className="group bg-secondary text-secondary-foreground hover:bg-secondary/80 flex h-9 w-full items-center justify-center rounded-lg transition-colors"
        onClick={dismissSignerApproval}
        aria-label={`${t('Waiting for signer approval...')} ${t('Close')}`}
        title={t('Waiting for signer approval...')}
      >
        <Loader2 className="animate-spin group-hover:hidden" />
        <X className="hidden group-hover:block" />
      </button>
    )
  }

  return (
    <SignerApprovalContent className="bg-secondary text-secondary-foreground rounded-lg ps-2.5 pe-1" />
  )
}

function SignerApprovalContent({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <div
      className={cn('flex h-9 min-w-0 items-center gap-2', className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-4 shrink-0 animate-spin opacity-70" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {t('Waiting for signer approval...')}
      </span>
      <button
        type="button"
        className="hover:bg-secondary-foreground/10 focus-visible:ring-ring flex size-7 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
        onClick={dismissSignerApproval}
        aria-label={t('Close')}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
