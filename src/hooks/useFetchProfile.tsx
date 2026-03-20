import { getProfileFromEvent } from '@/lib/event-metadata'
import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { replaceableEventService } from '@/services/client.service'
import { kinds } from 'nostr-tools'
import { TProfile } from '@/types'
import { useEffect, useState, useRef } from 'react'

export function useFetchProfile(id?: string, skipCache = false) {
  const { profile: currentAccountProfile } = useNostr()
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Function to check for profile updates
  const checkProfile = async (pubkey: string, cancelled: { current: boolean }) => {
    if (cancelled.current) return
    
    try {
      // Re-check cache (might have been updated by background fetch)
      const profileEvent = await replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Metadata)
      
      if (cancelled.current) return
      
      if (profileEvent) {
        const newProfile = getProfileFromEvent(profileEvent)
        if (newProfile) {
          setProfile(newProfile)
          setIsFetching(false)
          // Clear interval once we have a profile
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
          }
          return true
        }
      }
      return false
    } catch (err) {
      if (!cancelled.current) {
        setError(err as Error)
      }
      return false
    }
  }

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
    setPubkey(pubkey)

    const run = async () => {
      setIsFetching(true)
      setError(null)
      
      // Initial fetch
      const found = await checkProfile(pubkey, cancelled)
      
      if (cancelled.current) return
      
      if (found) {
        // Profile found, we're done
        return
      }
      
      // No profile found yet - set fetching to false but keep checking in background
      setIsFetching(false)
      
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
  }, [id, skipCache])

  useEffect(() => {
    if (currentAccountProfile && pubkey === currentAccountProfile.pubkey) {
      setProfile(currentAccountProfile)
      // Clear interval if we got the profile from current account
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
        checkIntervalRef.current = null
      }
    }
  }, [currentAccountProfile, pubkey])

  return { isFetching, error, profile }
}
