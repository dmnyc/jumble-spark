import { TWebMetadata } from '@/types'
import { useEffect, useState } from 'react'
import webService from '@/services/web.service'
import logger from '@/lib/logger'
import { isLikelyWebPageUrl } from '@/lib/url'

export function useFetchWebMetadata(url: string) {
  const [metadata, setMetadata] = useState<TWebMetadata>({})
  const [ogLoading, setOgLoading] = useState(() => Boolean(url && isLikelyWebPageUrl(url)))

  useEffect(() => {
    if (!url || !isLikelyWebPageUrl(url)) {
      setMetadata({})
      setOgLoading(false)
      return
    }

    logger.debug('[useFetchWebMetadata] Fetching OG metadata', { url })

    setOgLoading(true)
    setMetadata({})

    webService.fetchWebMetadata(url)
      .then((metadata) => {
        logger.debug('[useFetchWebMetadata] Received metadata', { url, hasTitle: !!metadata.title, hasDescription: !!metadata.description, hasImage: !!metadata.image })
        setMetadata(metadata)
      })
      .catch((error) => {
        logger.debug('[useFetchWebMetadata] Failed to fetch metadata', { url, error })
      })
      .finally(() => {
        setOgLoading(false)
      })
  }, [url])

  return { ...metadata, ogLoading }
}
