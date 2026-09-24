import {
  downloadImage,
  prepareImageForSave,
  shouldPrepareImageForShare,
  type PreparedImage,
  type SaveAs
} from '@/lib/save-image'
import { useCallback, useEffect, useState } from 'react'

export function useImageSave(url: string | undefined, enabled: boolean) {
  const [prepared, setPrepared] = useState<{ url: string; image: PreparedImage }>()

  useEffect(() => {
    if (!enabled || !url || !shouldPrepareImageForShare()) return

    const controller = new AbortController()
    prepareImageForSave(url, controller.signal)
      .then((image) => setPrepared({ url, image }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setPrepared(undefined)
      })

    return () => controller.abort()
  }, [enabled, url])

  const preparedImage = prepared && prepared.url === url ? prepared.image : undefined

  return useCallback(
    (saveAs: SaveAs) => {
      if (url) void downloadImage(url, preparedImage, saveAs)
    },
    [preparedImage, url]
  )
}
