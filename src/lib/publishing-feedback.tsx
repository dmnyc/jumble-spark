import RelayStatusDisplay from '@/components/RelayStatusDisplay'
import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

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
    toast.success(message, { duration: 2000 })
    return
  }

  // Show toast with custom relay status display
  const isSuccess = successCount > 0
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
  toast.success(message, { duration: 2000 })
}

/**
 * Show publishing error
 */
export function showPublishingError(error: Error | string) {
  const message = error instanceof Error ? error.message : error
  toast.error(message, { duration: 4000 })
}

