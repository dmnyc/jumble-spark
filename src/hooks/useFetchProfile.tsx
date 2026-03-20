import { getProfileFromEvent } from '@/lib/event-metadata'
import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { replaceableEventService } from '@/services/client.service'
import { TProfile } from '@/types'
import { useEffect, useState, useRef, useCallback } from 'react'
import logger from '@/lib/logger'

export function useFetchProfile(id?: string, skipCache = false) {
  // Log hook invocation immediately - this will show if the hook is even being called
  logger.info('[useFetchProfile] Hook called', { 
    id: id || 'undefined',
    skipCache,
    stack: new Error().stack?.split('\n').slice(1, 4).join('\n')
  })
  
  const { profile: currentAccountProfile } = useNostr()
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const processingPubkeyRef = useRef<string | null>(null) // Track which pubkey we're currently processing (prevents duplicate fetches)
  const effectRunCountRef = useRef<Map<string, number>>(new Map()) // Track how many times effect has run for each pubkey (safety guard against infinite loops)

  // Function to check for profile updates
  // fetchProfileEvent already checks: 1) IndexedDB, 2) network (with author's relays)
  // Memoize to prevent recreation on every render
  const checkProfile = useCallback(async (pubkey: string, cancelled: { current: boolean }) => {
    logger.info('[useFetchProfile] checkProfile called', {
      pubkey,
      cancelled: cancelled.current,
      skipCache
    })
    
    if (cancelled.current) {
      logger.info('[useFetchProfile] Already cancelled, returning false')
      return false
    }
    
    logger.info('[useFetchProfile] Starting profile fetch', {
      pubkey,
      skipCache
    })
    
    try {
      const startTime = Date.now()
      logger.info('[useFetchProfile] Calling fetchProfileEvent', {
        pubkey
      })
      
      // Use fetchProfileEvent which includes author's relay list for better profile discovery
      const profileEvent = await replaceableEventService.fetchProfileEvent(pubkey, skipCache)
      const fetchTime = Date.now() - startTime
      
      logger.info('[useFetchProfile] fetchProfileEvent returned', {
        pubkey,
        hasEvent: !!profileEvent,
        eventId: profileEvent?.id,
        fetchTime: `${fetchTime}ms`
      })
      
      if (cancelled.current) {
        logger.info('[useFetchProfile] Fetch cancelled after fetch', { pubkey })
        return false
      }
      
      if (profileEvent) {
        // getProfileFromEvent always returns a profile object (with fallback username)
        const newProfile = getProfileFromEvent(profileEvent)
        logger.info('[useFetchProfile] Profile found', {
          pubkey,
          username: newProfile.username,
          hasAvatar: !!newProfile.avatar,
          eventId: profileEvent.id,
          fetchTime: `${fetchTime}ms`
        })
        setProfile(newProfile)
        setIsFetching(false)
        // Keep processingPubkeyRef set so we don't re-fetch
        // Clear interval once we have a profile
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current)
          checkIntervalRef.current = null
        }
        // Clear run count when profile is found
        effectRunCountRef.current.delete(pubkey)
        return true
      }
      logger.warn('[useFetchProfile] No profile event found', {
        pubkey,
        fetchTime: `${fetchTime}ms`
      })
      return false
    } catch (err) {
      logger.error('[useFetchProfile] Profile fetch error', {
        pubkey,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        cancelled: cancelled.current
      })
        if (!cancelled.current) {
          setError(err as Error)
          setIsFetching(false)
        }
      return false
    }
  }, [skipCache])

  useEffect(() => {
    logger.info('[useFetchProfile] useEffect triggered', { 
      id: id || 'undefined',
      skipCache,
      processingPubkey: processingPubkeyRef.current
    })
    
    // Extract pubkey early to check if id has changed
    const extractedPubkey = id ? userIdToPubkey(id) : null
    
    // EARLY EXIT: If we're already processing this exact pubkey, skip immediately
    // This prevents the effect from doing any work if it's already running
    if (extractedPubkey && processingPubkeyRef.current === extractedPubkey) {
      logger.info('[useFetchProfile] EARLY EXIT: Already processing this pubkey', {
        extractedPubkey,
        processingPubkey: processingPubkeyRef.current
      })
      return
    }
    
    // Guard against infinite loops: limit effect runs per pubkey
    if (extractedPubkey) {
      const runCount = effectRunCountRef.current.get(extractedPubkey) || 0
      if (runCount > 10) {
        logger.warn('[useFetchProfile] Too many effect runs for this pubkey, preventing infinite loop', {
          extractedPubkey,
          runCount
        })
        return
      }
      effectRunCountRef.current.set(extractedPubkey, runCount + 1)
    }
    
    // If id has changed (extractedPubkey is different from processingPubkeyRef), clear the ref
    // This allows a new fetch to start for a different pubkey
    if (extractedPubkey && processingPubkeyRef.current && processingPubkeyRef.current !== extractedPubkey) {
      const oldPubkey = processingPubkeyRef.current
      logger.info('[useFetchProfile] ID changed, clearing refs', {
        oldPubkey,
        newPubkey: extractedPubkey
      })
      // Clear run count for old pubkey before clearing ref
      effectRunCountRef.current.delete(oldPubkey)
      processingPubkeyRef.current = null
    }
    
    if (!id) {
      logger.warn('[useFetchProfile] No id provided')
      setProfile(null)
      setPubkey(null)
      setIsFetching(false)
      setError(new Error('No id provided'))
      processingPubkeyRef.current = null
      return
    }

    const cancelled = { current: false }
    logger.info('[useFetchProfile] Attempting to extract pubkey', {
      id,
      idLength: id.length,
      idStartsWithNpub: id.startsWith('npub1'),
      idStartsWithNprofile: id.startsWith('nprofile1')
    })
    
    // Use the already-extracted pubkey from above
    // const extractedPubkey = userIdToPubkey(id) // Already extracted above
    logger.info('[useFetchProfile] Extracted pubkey result', {
      id,
      extractedPubkey: extractedPubkey || 'null',
      pubkeyLength: extractedPubkey ? extractedPubkey.length : 0,
      isValidPubkey: extractedPubkey ? /^[0-9a-f]{64}$/.test(extractedPubkey) : false
    })
    
    if (!extractedPubkey) {
      logger.error('[useFetchProfile] Invalid id - could not extract pubkey', {
        id,
        idLength: id.length
      })
      setProfile(null)
      setPubkey(null)
      setIsFetching(false)
      setError(new Error('Invalid id: could not extract pubkey'))
      processingPubkeyRef.current = null
      return
    }
    
    // Validate pubkey format
    if (extractedPubkey.length !== 64 || !/^[0-9a-f]{64}$/.test(extractedPubkey)) {
      logger.error('[useFetchProfile] Invalid pubkey format', {
        id,
        extractedPubkey,
        pubkeyLength: extractedPubkey.length,
        expectedLength: 64
      })
      setProfile(null)
      setPubkey(null)
      setIsFetching(false)
      setError(new Error(`Invalid pubkey format: expected 64 hex chars, got ${extractedPubkey.length}`))
      processingPubkeyRef.current = null
      return
    }
    
    // CRITICAL: Check if we're already processing this pubkey IMMEDIATELY after validation
    // This must happen before any other logic to prevent infinite loops
    if (processingPubkeyRef.current === extractedPubkey) {
      logger.info('[useFetchProfile] Already processing this pubkey, skipping duplicate fetch', {
        extractedPubkey,
        processingPubkey: processingPubkeyRef.current,
        hasProfile: !!profile
      })
      return
    }
    
    // Also check if we already have a profile for this pubkey before starting a new fetch
    if (profile && profile.pubkey === extractedPubkey) {
      logger.info('[useFetchProfile] Already have profile for this pubkey, skipping fetch', {
        extractedPubkey
      })
      // Still update the ref to prevent re-processing
      processingPubkeyRef.current = extractedPubkey
      setIsFetching(false)
      if (pubkey !== extractedPubkey) {
        setPubkey(extractedPubkey)
      }
      return
    }
    
    // CRITICAL: Mark that we're processing this pubkey IMMEDIATELY after validation
    // This must happen before any state updates or async operations
    // This prevents the effect from running again for the same pubkey
    processingPubkeyRef.current = extractedPubkey
    
    // Only set pubkey state if it's different to avoid unnecessary re-renders
    // Do this AFTER setting the ref to prevent loops
    if (pubkey !== extractedPubkey) {
      setPubkey(extractedPubkey)
    }
    logger.info('[useFetchProfile] Starting profile fetch async', {
      extractedPubkey,
      currentPubkeyState: pubkey || 'null'
    })

    const run = async () => {
      logger.info('[useFetchProfile] run() async function started', {
        pubkey: extractedPubkey
      })
      
      try {
        setIsFetching(true)
        setError(null)
        
        logger.info('[useFetchProfile] Calling checkProfile', {
          pubkey: extractedPubkey
        })
        
        // Initial fetch - fetchReplaceableEvent checks: 1) in-memory, 2) IndexedDB, 3) network
        const found = await checkProfile(extractedPubkey, cancelled)
        
        logger.info('[useFetchProfile] checkProfile returned', {
          pubkey: extractedPubkey,
          found,
          cancelled: cancelled.current
        })
        
        if (cancelled.current) {
          logger.info('[useFetchProfile] Cancelled after checkProfile, cleaning up')
          setIsFetching(false)
          return
        }
        
        if (found) {
          logger.info('[useFetchProfile] Profile found, done')
          // Profile found (from cache or network), we're done
          return
        }
        
        logger.info('[useFetchProfile] No profile found, setting up interval retry')
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
          const found = await checkProfile(extractedPubkey, cancelled)
          if (found || cancelled.current) {
            // Profile found or cancelled, stop checking
            if (checkIntervalRef.current) {
              clearInterval(checkIntervalRef.current)
              checkIntervalRef.current = null
            }
          }
        }, 2000) // Check every 2 seconds
      } catch (err) {
                 logger.error('[useFetchProfile] run() error', {
                   pubkey: extractedPubkey,
                   error: err instanceof Error ? err.message : String(err),
                   stack: err instanceof Error ? err.stack : undefined
                 })
        if (!cancelled.current) {
          setError(err as Error)
          setIsFetching(false)
        }
      }
    }

    logger.info('[useFetchProfile] About to call run()', {
      pubkey: extractedPubkey
    })
    run().catch((err) => {
      logger.error('[useFetchProfile] Unhandled error in run()', {
        pubkey: extractedPubkey,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      })
    })
    return () => {
      cancelled.current = true
      // Only clear processingPubkeyRef if it matches the current pubkey
      // This prevents clearing it if a new fetch has already started
      if (processingPubkeyRef.current === extractedPubkey) {
        processingPubkeyRef.current = null
      }
      // Clear interval on cleanup
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
