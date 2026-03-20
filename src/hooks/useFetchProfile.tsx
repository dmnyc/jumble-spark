import { getProfileFromEvent } from '@/lib/event-metadata'
import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { replaceableEventService } from '@/services/client.service'
import { TProfile } from '@/types'
import { useEffect, useState, useRef, useCallback } from 'react'
import logger from '@/lib/logger'

export function useFetchProfile(id?: string, skipCache = false) {
  // CRITICAL: Reduce logging to prevent performance issues during infinite loops
  // Only log if we're actually going to process (not just checking)
  // logger.info('[useFetchProfile] Hook called', { 
  //   id: id || 'undefined',
  //   skipCache,
  //   stack: new Error().stack?.split('\n').slice(1, 4).join('\n')
  // })
  
  const { profile: currentAccountProfile } = useNostr()
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const processingPubkeyRef = useRef<string | null>(null) // Track which pubkey we're currently processing (prevents duplicate fetches)
  const effectRunCountRef = useRef<Map<string, number>>(new Map()) // Track how many times effect has run for each pubkey (safety guard against infinite loops)
  const initializedPubkeysRef = useRef<Set<string>>(new Set()) // Track pubkeys we've successfully initialized (have profile or failed)

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
        // Mark as initialized
        initializedPubkeysRef.current.add(pubkey)
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
    // CRITICAL: Reduce logging - only log when actually processing, not on every render
    // logger.info('[useFetchProfile] useEffect triggered', { 
    //   id: id || 'undefined',
    //   skipCache,
    //   processingPubkey: processingPubkeyRef.current,
    //   hasProfile: !!profile,
    //   profilePubkey: profile?.pubkey
    // })
    
    // Extract pubkey early to check if id has changed
    const extractedPubkey = id ? userIdToPubkey(id) : null
    
    // CRITICAL: Early exit if already processing this exact pubkey - prevents infinite loops
    // This check must happen FIRST, before any other logic
    if (extractedPubkey && processingPubkeyRef.current === extractedPubkey) {
      // Silently exit - no logging to reduce noise
      return
    }
    
    // CRITICAL: Early exit if we already have a profile for this pubkey
    // This prevents re-fetching when we already have the profile
    if (extractedPubkey && profile && profile.pubkey === extractedPubkey) {
      // Ensure processingPubkeyRef is set to prevent re-fetch
      if (processingPubkeyRef.current !== extractedPubkey) {
        processingPubkeyRef.current = extractedPubkey
      }
      // Mark as initialized
      initializedPubkeysRef.current.add(extractedPubkey)
      // Ensure fetching is false (but don't call setState if already false to avoid re-renders)
      if (isFetching) {
        setIsFetching(false)
      }
      // Clear run count since we have the profile
      effectRunCountRef.current.delete(extractedPubkey)
      return
    }
    
    // CRITICAL: Early exit if we've already initialized this pubkey (even if profile is null)
    // This prevents re-fetching when we've already tried and failed
    // BUT: Allow retry if skipCache is true (user explicitly wants to refresh)
    if (extractedPubkey && initializedPubkeysRef.current.has(extractedPubkey) && !profile && !skipCache) {
      // Already tried and failed - don't retry unless explicitly requested
      // Ensure fetching is false
      if (isFetching) {
        setIsFetching(false)
      }
      return
    }
    
    // CRITICAL: Guard against infinite loops - limit effect runs per pubkey (reduced from 10 to 3)
    // Only increment if we're actually going to process (not early exiting)
    if (extractedPubkey) {
      const runCount = effectRunCountRef.current.get(extractedPubkey) || 0
      if (runCount >= 3) {
        logger.warn('[useFetchProfile] Too many effect runs for this pubkey, preventing infinite loop', {
          extractedPubkey,
          runCount
        })
        // Clear the run count after a delay to allow retries later
        setTimeout(() => {
          effectRunCountRef.current.delete(extractedPubkey)
        }, 30000) // Clear after 30 seconds
        return
      }
      // Only increment if we're actually going to process
      effectRunCountRef.current.set(extractedPubkey, runCount + 1)
    }
    
    // If id has changed (extractedPubkey is different from processingPubkeyRef), clear the refs
    // This allows a new fetch to start for a different pubkey
    if (extractedPubkey && processingPubkeyRef.current && processingPubkeyRef.current !== extractedPubkey) {
      const oldPubkey = processingPubkeyRef.current
      // Clear run count and initialized status for old pubkey before clearing ref
      effectRunCountRef.current.delete(oldPubkey)
      initializedPubkeysRef.current.delete(oldPubkey)
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
    
    // These checks are now done earlier in the effect (before incrementing run count)
    // Keeping this as a safety check, but it should rarely be hit
    if (processingPubkeyRef.current === extractedPubkey) {
      logger.info('[useFetchProfile] Already processing this pubkey (safety check)', {
        extractedPubkey,
        processingPubkey: processingPubkeyRef.current
      })
      return
    }
    
    if (profile && profile.pubkey === extractedPubkey) {
      logger.info('[useFetchProfile] Already have profile for this pubkey (safety check)', {
        extractedPubkey
      })
      processingPubkeyRef.current = extractedPubkey
      setIsFetching(false)
      effectRunCountRef.current.delete(extractedPubkey)
      return
    }
    
    // CRITICAL: Mark that we're processing this pubkey IMMEDIATELY after validation
    // This must happen before any state updates or async operations
    // This prevents the effect from running again for the same pubkey
    processingPubkeyRef.current = extractedPubkey
    
    // CRITICAL: Only update pubkey state if it's actually different
    // Avoid state updates that could trigger re-renders and loops
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
        // REDUCED: Check every 5 seconds for up to 20 seconds (4 checks) to prevent too many intervals
        // This reduces memory usage when many profiles are being fetched (e.g., trending page)
        let checkCount = 0
        const maxChecks = 4 // Reduced from 15 to prevent browser crashes
        
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
        }, 5000) // Increased from 2 seconds to 5 seconds to reduce load
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
    // CRITICAL: Only use currentAccountProfile if it matches the pubkey we're looking for
    // Use pubkey from the profile object to avoid reference equality issues
    // Only update if we don't have a profile yet AND we're not currently processing
    // CRITICAL FIX: Don't include profile in dependencies to prevent infinite loops
    // We only read profile to check if it exists, we don't need to re-run when it changes
    if (currentAccountProfile?.pubkey && pubkey && pubkey === currentAccountProfile.pubkey) {
      // Only update if we don't have a profile yet (avoid unnecessary updates)
      // Also check that we're processing this pubkey to prevent race conditions
      if (!profile && processingPubkeyRef.current === pubkey) {
        setProfile(currentAccountProfile)
        setIsFetching(false)
        // Clear interval if we got the profile from current account
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current)
          checkIntervalRef.current = null
        }
        // Clear run count since we have the profile
        effectRunCountRef.current.delete(pubkey)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAccountProfile?.pubkey, pubkey]) // Removed profile from dependencies to prevent infinite loops

  return { isFetching, error, profile }
}
