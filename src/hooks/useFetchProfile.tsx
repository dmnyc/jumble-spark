import { getProfileFromEvent } from '@/lib/event-metadata'
import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { replaceableEventService } from '@/services/client.service'
import { TProfile } from '@/types'
import { useEffect, useState, useRef, useCallback } from 'react'
import logger from '@/lib/logger'

export function useFetchProfile(id?: string, skipCache = false) {
  const { profile: currentAccountProfile } = useNostr()
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Function to check for profile updates
  // fetchProfileEvent already checks: 1) in-memory cache, 2) IndexedDB, 3) network (with author's relays)
  // Memoize to prevent recreation on every render
  const checkProfile = useCallback(async (pubkey: string, cancelled: { current: boolean }) => {
    if (cancelled.current) return false
    
    try {
      // Use fetchProfileEvent which includes author's relay list for better profile discovery
      // fetchProfileEvent handles all cache layers:
      // 1. In-memory cache (instant return)
      // 2. IndexedDB (fast async)
      // 3. Network (with author's relay list for better discovery)
      const profileEvent = await replaceableEventService.fetchProfileEvent(pubkey, skipCache)
      
      if (cancelled.current) return false
      
      if (profileEvent) {
        // getProfileFromEvent always returns a profile object (with fallback username)
        const newProfile = getProfileFromEvent(profileEvent)
        logger.debug('[useFetchProfile] Profile found', {
          pubkey: pubkey.substring(0, 8),
          username: newProfile.username,
          hasAvatar: !!newProfile.avatar
        })
        setProfile(newProfile)
        setIsFetching(false)
        // Clear interval once we have a profile
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current)
          checkIntervalRef.current = null
        }
        return true
      }
      logger.debug('[useFetchProfile] No profile event found', {
        pubkey: pubkey.substring(0, 8)
      })
      return false
    } catch (err) {
      if (!cancelled.current) {
        setError(err as Error)
        setIsFetching(false)
      }
      return false
    }
  }, [skipCache])

  useEffect(() => {
    if (!id) {
      setProfile(null)
      setPubkey(null)
      setIsFetching(false)
      setError(new Error('No id provided'))
      return
    }

    const cancelled = { current: false }
    const pubkey = userIdToPubkey(id)
    if (!pubkey) {
      setProfile(null)
      setPubkey(null)
      setIsFetching(false)
      setError(new Error('Invalid id: could not extract pubkey'))
      return
    }
    setPubkey(pubkey)

    const run = async () => {
      setIsFetching(true)
      setError(null)
      
      // Initial fetch - fetchReplaceableEvent checks: 1) in-memory, 2) IndexedDB, 3) network
      const found = await checkProfile(pubkey, cancelled)
      
      if (cancelled.current) return
      
      if (found) {
        // Profile found (from cache or network), we're done
        return
      }
      
      // No profile found yet - set fetching to false so UI can show fallback
      // The profile will remain null, allowing components to show npub fallback
      setIsFetching(false)
      setError(null) // Clear any previous errors
      
      // If no profile was found, periodically re-check (profiles might load asynchronously)
      // Check every 2 seconds for up to 30 seconds (15 checks)
      let checkCount = 0
      const maxChecks = 15
      
      checkIntervalRef.current = setInterval(async () => {
        if (cancelled.current || checkCount >= maxChecks) {
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
          }
          return
        }
        
        checkCount++
        const found = await checkProfile(pubkey, cancelled)
        if (found) {
          // Profile found, stop checking
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
          }
        }
      }, 2000) // Check every 2 seconds
    }

    run()
    return () => {
      cancelled.current = true
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
        checkIntervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, skipCache]) // checkProfile is memoized and stable, no need to include it

  useEffect(() => {
    // Only use currentAccountProfile if it matches the pubkey we're looking for
    // Use pubkey from the profile object to avoid reference equality issues
    if (currentAccountProfile?.pubkey && pubkey && pubkey === currentAccountProfile.pubkey) {
      // Only update if we don't have a profile yet (avoid unnecessary updates)
      // Using a ref to track if we've already set it to prevent loops
      if (!profile) {
        setProfile(currentAccountProfile)
        setIsFetching(false)
        // Clear interval if we got the profile from current account
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current)
          checkIntervalRef.current = null
        }
      }
    }
  }, [currentAccountProfile?.pubkey, pubkey]) // Removed profile?.pubkey to prevent loops

  return { isFetching, error, profile }
}
