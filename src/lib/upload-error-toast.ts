import { UPLOAD_ABORTED_ERROR_MSG } from '@/services/media-upload.service'
import { toast } from 'sonner'

/**
 * Show a media-upload failure as a toast. The toast stays until the user
 * dismisses it (instead of auto-hiding), so a fast-failing server error isn't
 * gone before it can be read.
 */
export function showUploadErrorToast(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  // Aborts are user-initiated; nothing to report.
  if (message === UPLOAD_ABORTED_ERROR_MSG) return

  toast.error(message, {
    duration: Infinity,
    closeButton: true
  })
}
