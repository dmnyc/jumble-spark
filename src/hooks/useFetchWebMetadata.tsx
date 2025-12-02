import { TWebMetadata } from '@/types'
import { useEffect, useState } from 'react'
import webService from '@/services/web.service'
import logger from '@/lib/logger'

export function useFetchWebMetadata(url: string) {
  const [metadata, setMetadata] = useState<TWebMetadata>({})

  useEffect(() => {
    if (!url) {
      return
    }
    
    logger.info('[useFetchWebMetadata] Fetching OG metadata', { url })
    
    // Pass original URL - web service will handle proxy conversion
    webService.fetchWebMetadata(url)
      .then((metadata) => {
        logger.info('[useFetchWebMetadata] Received metadata', { url, hasTitle: !!metadata.title, hasDescription: !!metadata.description, hasImage: !!metadata.image })
        setMetadata(metadata)
      })
      .catch((error) => {
        logger.error('[useFetchWebMetadata] Failed to fetch metadata', { url, error })
      })
  }, [url])

  return metadata
}
