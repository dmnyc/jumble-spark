import mediaUpload, { UPLOAD_ABORTED_ERROR_MSG } from '@/services/media-upload.service'
import { useRef } from 'react'
import { toast } from 'sonner'
import logger from '@/lib/logger'

export default function Uploader({
  children,
  onUploadSuccess,
  onUploadStart,
  onUploadEnd,
  onProgress,
  className,
  accept = 'image/*'
}: {
  children: React.ReactNode
  onUploadSuccess: ({ url, tags }: { url: string; tags: string[][] }) => void
  onUploadStart?: (file: File, cancel: () => void) => void
  onUploadEnd?: (file: File) => void
  onProgress?: (file: File, progress: number) => void
  className?: string
  accept?: string
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return

    const abortControllerMap = new Map<File, AbortController>()

    for (const file of event.target.files) {
      const abortController = new AbortController()
      abortControllerMap.set(file, abortController)
      onUploadStart?.(file, () => abortController.abort())
    }

    for (const file of event.target.files) {
      try {
        logger.debug('Starting file upload', { fileName: file.name, fileType: file.type, fileSize: file.size })
        const abortController = abortControllerMap.get(file)
        const result = await mediaUpload.upload(file, {
          onProgress: (p) => {
            logger.debug('Upload progress', { fileName: file.name, progress: p })
            onProgress?.(file, p)
          },
          signal: abortController?.signal
        })
        logger.debug('File upload successful', { fileName: file.name, url: result.url })
        onUploadSuccess(result)
        onUploadEnd?.(file)
      } catch (error) {
        logger.error('Error uploading file', { 
          error, 
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        })
        const message = (error as Error).message
        if (message !== UPLOAD_ABORTED_ERROR_MSG) {
          toast.error(`Failed to upload file: ${message}`)
        }
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        onUploadEnd?.(file)
      }
    }
  }

  const handleUploadClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    if (fileInputRef.current) {
      fileInputRef.current.value = '' // clear the value so that the same file can be uploaded again
      fileInputRef.current.click()
    }
  }

  return (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      <div onClick={handleUploadClick} role="button" tabIndex={0} onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          handleUploadClick(e as any)
        }
      }}>{children}</div>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        accept={accept}
        multiple
      />
    </div>
  )
}
