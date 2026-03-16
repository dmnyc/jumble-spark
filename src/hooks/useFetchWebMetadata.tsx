import { TWebMetadata } from '@/types'
import { useEffect, useState } from 'react'
import webService from '@/services/web.service'
import logger from '@/lib/logger'
import { isLikelyWebPageUrl } from '@/lib/url'

export function useFetchWebMetadata(url: string) {
  const [metadata, setMetadata] = useState<TWebMetadata>({})

  useEffect(() => {
    if (!url || !isLikelyWebPageUrl(url)) {
      return
    }

    logger.debug('[useFetchWebMetadata] Fetching OG metadata', { url })

    webService.fetchWebMetadata(url)
      .then((metadata) => {
        logger.debug('[useFetchWebMetadata] Received metadata', { url, hasTitle: !!metadata.title, hasDescription: !!metadata.description, hasImage: !!metadata.image })
        setMetadata(metadata)
      })
      .catch((error) => {
        logger.debug('[useFetchWebMetadata] Failed to fetch metadata', { url, error })
      })
  }, [url])

  return metadata
}
