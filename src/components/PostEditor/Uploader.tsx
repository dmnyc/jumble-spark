import { showUploadErrorToast } from '@/lib/upload-error-toast'
import mediaUpload from '@/services/media-upload.service'
import { useRef } from 'react'

export default function Uploader({
  children,
  onUploadSuccess,
  onUploadStart,
  onUploadEnd,
  onProgress,
  className,
  accept = 'image/*',
  multiple = true,
  validateFile
}: {
  children: React.ReactNode
  onUploadSuccess: ({ url, tags }: { url: string; tags: string[][] }, file: File) => void
  onUploadStart?: (file: File, cancel: () => void) => void
  onUploadEnd?: (file: File) => void
  onProgress?: (file: File, progress: number) => void
  className?: string
  accept?: string
  multiple?: boolean
  validateFile?: (file: File) => string | undefined
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return

    const files = Array.from(event.target.files)
    const validFiles = files.filter((file) => {
      const validationError = validateFile?.(file)
      if (!validationError) return true

      showUploadErrorToast(new Error(validationError))
      return false
    })

    const abortControllerMap = new Map<File, AbortController>()

    for (const file of validFiles) {
      const abortController = new AbortController()
      abortControllerMap.set(file, abortController)
      onUploadStart?.(file, () => abortController.abort())
    }

    for (const file of validFiles) {
      try {
        const abortController = abortControllerMap.get(file)
        const result = await mediaUpload.upload(file, {
          onProgress: (p) => onProgress?.(file, p),
          signal: abortController?.signal
        })
        onUploadSuccess(result, file)
        onUploadEnd?.(file)
      } catch (error) {
        console.error('Error uploading file', error)
        showUploadErrorToast(error)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        onUploadEnd?.(file)
      }
    }
  }

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '' // clear the value so that the same file can be uploaded again
      fileInputRef.current.click()
    }
  }

  return (
    <div className={className}>
      <div onClick={handleUploadClick}>{children}</div>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        accept={accept}
        multiple={multiple}
      />
    </div>
  )
}
