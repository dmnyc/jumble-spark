import { isInsecureUrl } from '@/lib/url'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import webService from '@/services/web.service'
import { TWebMetadata } from '@/types'
import { useEffect, useState } from 'react'

type WebMetadataState = {
  url: string
  metadata: TWebMetadata
  isLoading: boolean
}

export function useFetchWebMetadata(url: string, enabled = true) {
  const { allowInsecureConnection } = useUserPreferences()
  const [state, setState] = useState<WebMetadataState>({
    url: '',
    metadata: {},
    isLoading: false
  })

  useEffect(() => {
    if (!enabled || (!allowInsecureConnection && isInsecureUrl(url))) return

    let ignore = false
    setState({ url, metadata: {}, isLoading: true })

    webService
      .fetchWebMetadata(url)
      .then((metadata) => {
        if (!ignore) setState({ url, metadata, isLoading: false })
      })
      .catch(() => {
        if (!ignore) setState({ url, metadata: {}, isLoading: false })
      })

    return () => {
      ignore = true
    }
  }, [url, enabled, allowInsecureConnection])

  if (!enabled) {
    return { metadata: {}, isLoading: false }
  }

  if (state.url !== url) {
    return { metadata: {}, isLoading: true }
  }

  return { metadata: state.metadata, isLoading: state.isLoading }
}
