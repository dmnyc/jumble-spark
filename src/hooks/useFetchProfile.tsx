import { getProfileFromEvent } from '@/lib/event-metadata'
import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { replaceableEventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
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
        // Get cached profile from IndexedDB
        const cachedEvent = await indexedDb.getReplaceableEvent(pubkey, kinds.Metadata)
        const cached = cachedEvent ? getProfileFromEvent(cachedEvent) : undefined
        
        // Fetch fresh profile
        const profileEvent = await replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Metadata)
        const profile = profileEvent ? getProfileFromEvent(profileEvent) : undefined
        
        if (cancelled) return
        
        if (cached) setProfile(cached)
        if (profile) setProfile(profile)
      } catch (err) {
        if (!cancelled) setError(err as Error)
      } finally {
        if (!cancelled) setIsFetching(false)
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
