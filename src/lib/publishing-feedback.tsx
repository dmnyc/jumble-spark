import RelayStatusDisplay from '@/components/RelayStatusDisplay'
import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import storage from '@/services/local-storage.service'
import { toast } from 'sonner'

export type PublishSuccessSubtleDetail = { message?: string }

export const PUBLISH_SUCCESS_SUBTLE_EVENT = 'jumble:publishSuccessSubtle'

export function emitPublishSuccessSubtle(message?: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<PublishSuccessSubtleDetail>(PUBLISH_SUCCESS_SUBTLE_EVENT, {
      detail: { message }
    })
  )
}

function publishSuccessToastsEnabled(): boolean {
  return storage.getShowPublishSuccessToasts()
}

function resolvePromiseSuccessLabel(success: string | (() => ReactNode)): string | undefined {
  if (typeof success === 'string') return success
  try {
    const v = success()
    if (typeof v === 'string') return v
  } catch {
    /* ignore */
  }
  return undefined
}

export type RelayStatus = {
  url: string
  success: boolean
  error?: string
  message?: string
  authAttempted?: boolean
}

export type PublishResult = {
  success: boolean
  relayStatuses: RelayStatus[]
  successCount: number
  totalCount: number
}

/**
 * Show publishing feedback with relay status details
 * @param result Publishing result with relay statuses
 * @param options Optional configuration
 */
export function showPublishingFeedback(
  result: PublishResult,
  options: {
    message?: string
    duration?: number
  } = {}
) {
  const { message = 'Published successfully', duration = 6000 } = options
  
  const { relayStatuses, successCount, totalCount } = result

  if (relayStatuses.length === 0) {
    // Fallback for events without relay status tracking
    if (publishSuccessToastsEnabled()) {
      toast.success(message, { duration: 2000 })
    } else {
      emitPublishSuccessSubtle(message)
    }
    return
  }

  const isSuccess = successCount > 0
  if (isSuccess && !publishSuccessToastsEnabled()) {
    emitPublishSuccessSubtle(message)
    return
  }

  const toastFunction = isSuccess ? toast.success : toast.error
  
  toastFunction(
    <div className="w-full min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className={`w-5 h-5 ${isSuccess ? 'text-green-500' : 'text-red-500'}`} />
        <div className="font-semibold">{message}</div>
      </div>
      <div className="text-xs text-muted-foreground mb-2">
        Published to {successCount} of {totalCount} relays
      </div>
      <RelayStatusDisplay
        relayStatuses={relayStatuses}
        successCount={successCount}
        totalCount={totalCount}
      />
    </div>,
    { 
      duration,
      className: 'max-w-lg w-full'
    }
  )
}

/**
 * Simple success toast without relay details
 */
export function showSimplePublishSuccess(message = 'Published successfully') {
  if (!publishSuccessToastsEnabled()) return
  toast.success(message, { duration: 2000 })
}

/**
 * Show publishing error
 */
export function showPublishingError(error: Error | string) {
  const message = error instanceof Error ? error.message : error
  toast.error(message, { duration: 4000 })
}

type PublishPromiseToastOptions = {
  loading: string
  success: string | (() => ReactNode)
  error: (err: Error) => string
}

/**
 * Like `toast.promise` for publish/republish flows: respects {@link storage.getShowPublishSuccessToasts}
 * (no green success toast when disabled). Loading and error toasts still appear.
 */
export function toastPublishPromise<T>(promise: Promise<T>, opts: PublishPromiseToastOptions): void {
  if (!publishSuccessToastsEnabled()) {
    const id = toast.loading(opts.loading)
    promise
      .then(() => {
        toast.dismiss(id)
        const label = resolvePromiseSuccessLabel(opts.success)
        emitPublishSuccessSubtle(label)
      })
      .catch((err: unknown) => {
        toast.dismiss(id)
        const e = err instanceof Error ? err : new Error(String(err))
        toast.error(opts.error(e))
      })
    return
  }
  toast.promise(promise, opts)
}

