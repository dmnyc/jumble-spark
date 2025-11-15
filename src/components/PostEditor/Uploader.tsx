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
    // Stop propagation to prevent event bubbling
    event.stopPropagation()
    
    if (!event.target.files) {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }

    const abortControllerMap = new Map<File, AbortController>()

    // Wrap in try-catch to handle any synchronous errors
    try {
      for (const file of event.target.files) {
        const abortController = new AbortController()
        abortControllerMap.set(file, abortController)
        try {
          onUploadStart?.(file, () => abortController.abort())
        } catch (error) {
          logger.error('Error in onUploadStart callback', { error, fileName: file.name })
        }
      }

      for (const file of event.target.files) {
        try {
          logger.debug('Starting file upload', { fileName: file.name, fileType: file.type, fileSize: file.size })
          const abortController = abortControllerMap.get(file)
          const result = await mediaUpload.upload(file, {
            onProgress: (p) => {
              try {
                logger.debug('Upload progress', { fileName: file.name, progress: p })
                onProgress?.(file, p)
              } catch (error) {
                logger.error('Error in onProgress callback', { error, fileName: file.name })
              }
            },
            signal: abortController?.signal
          })
          logger.debug('File upload successful', { fileName: file.name, url: result.url })
          try {
            onUploadSuccess(result)
          } catch (error) {
            logger.error('Error in onUploadSuccess callback', { error, fileName: file.name })
            toast.error('Failed to process uploaded file')
          }
          try {
            onUploadEnd?.(file)
          } catch (error) {
            logger.error('Error in onUploadEnd callback', { error, fileName: file.name })
          }
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
          try {
            onUploadEnd?.(file)
          } catch (endError) {
            logger.error('Error in onUploadEnd callback during error handling', { error: endError })
          }
        }
      }
    } catch (error) {
      // Catch any unexpected errors in the outer try-catch
      logger.error('Unexpected error in handleFileChange', { 
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      })
      toast.error('An unexpected error occurred during file upload')
    } finally {
      // Always reset the file input value
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleUploadClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.nativeEvent) {
      e.nativeEvent.stopImmediatePropagation()
    }
    
    // Prevent any form submission
    if ('currentTarget' in e && e.currentTarget instanceof HTMLElement) {
      const form = e.currentTarget.closest('form')
      if (form) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    
    try {
      if (fileInputRef.current) {
        fileInputRef.current.value = '' // clear the value so that the same file can be uploaded again
        fileInputRef.current.click()
      }
    } catch (error) {
      logger.error('Error triggering file input click', { error })
      toast.error('Failed to open file picker')
    }
  }

  return (
    <div 
      className={className} 
      onClick={(e) => {
        // Only stop propagation, don't prevent default to avoid interfering with file input
        e.stopPropagation()
      }}
    >
      <div 
        onClick={handleUploadClick}
        role="button" 
        tabIndex={0} 
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            handleUploadClick(e)
          }
        }}
        onMouseDown={(e) => {
          // Prevent any default behavior on mouse down
          e.preventDefault()
        }}
      >
        {children}
      </div>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        onClick={(e) => {
          // Prevent event bubbling
          e.stopPropagation()
        }}
        accept={accept}
        multiple
      />
    </div>
  )
}
