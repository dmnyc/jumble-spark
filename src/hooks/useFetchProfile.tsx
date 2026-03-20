import { getProfileFromEvent } from '@/lib/event-metadata'
import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { replaceableEventService } from '@/services/client.service'
import { kinds } from 'nostr-tools'
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
        // fetchReplaceableEvent now checks in-memory cache first (instant), then IndexedDB, then network
        // This is optimized for speed - memory cache is synchronous
        const profileEvent = await replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Metadata)
        
        if (cancelled) return
        
        if (profileEvent) {
          const profile = getProfileFromEvent(profileEvent)
          if (profile) {
            setProfile(profile)
            setIsFetching(false)
            return // Return immediately with cached/fetched profile
          }
        }
        
        // If we get here, no profile was found
        setIsFetching(false)
      } catch (err) {
        if (!cancelled) {
          setError(err as Error)
          setIsFetching(false)
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [id, skipCache])

  useEffect(() => {
    if (currentAccountProfile && pubkey === currentAccountProfile.pubkey) {
      setProfile(currentAccountProfile)
    }
  }, [currentAccountProfile, pubkey])

  return { isFetching, error, profile }
}
