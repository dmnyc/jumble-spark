import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { TProfile } from '@/types'
import { useEffect, useState } from 'react'

export function useFetchProfile(id?: string, skipCache = false) {
  const { profile: currentAccountProfile } = useNostr()
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setProfile(null)
      setPubkey(null)
      setIsFetching(false)
      setError(new Error('No id provided'))
      return
    }

    let cancelled = false
    const pubkey = userIdToPubkey(id)
    setPubkey(pubkey)

    const run = async () => {
      setIsFetching(true)
      try {
        const [cachedResult, fetchResult] = await Promise.allSettled([
          client.getProfileFromIndexedDB(id),
          client.fetchProfile(id, skipCache)
        ])
        if (cancelled) return
        const cached = cachedResult.status === 'fulfilled' ? cachedResult.value : undefined
        const profile = fetchResult.status === 'fulfilled' ? fetchResult.value : undefined
        if (cached) setProfile(cached)
        if (profile) setProfile(profile)
        if (fetchResult.status === 'rejected' && !cancelled) setError(fetchResult.reason as Error)
      } finally {
        if (!cancelled) setIsFetching(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (currentAccountProfile && pubkey === currentAccountProfile.pubkey) {
      setProfile(currentAccountProfile)
    }
  }, [currentAccountProfile, pubkey])

  return { isFetching, error, profile }
}
