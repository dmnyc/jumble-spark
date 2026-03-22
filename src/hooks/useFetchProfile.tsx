import { PROFILE_FETCH_PROMISE_TIMEOUT_MS } from '@/constants'
import { getProfileFromEvent } from '@/lib/event-metadata'
import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { useNoteFeedProfileContext } from '@/providers/NoteFeedProfileContext'
import { replaceableEventService } from '@/services/client.service'
import { TProfile } from '@/types'
import { useEffect, useState, useRef, useCallback } from 'react'
import logger from '@/lib/logger'

// CRITICAL: Global deduplication - shared across ALL hook instances
// This prevents multiple components from fetching the same profile simultaneously
const globalFetchPromises = new Map<string, Promise<TProfile | null>>()
const globalFetchingPubkeys = new Set<string>()
// Cooldown period after timeout to prevent cascade of duplicate fetches
const globalFetchCooldowns = new Map<string, number>() // pubkey -> timestamp when cooldown expires

export function useFetchProfile(id?: string, skipCache = false) {
  // CRITICAL: Reduce logging to prevent performance issues during infinite loops
  // Only log if we're actually going to process (not just checking)
  // logger.info('[useFetchProfile] Hook called', { 
  //   id: id || 'undefined',
  //   skipCache,
  //   stack: new Error().stack?.split('\n').slice(1, 4).join('\n')
  // })
  
  const { profile: currentAccountProfile } = useNostr()
  const noteFeed = useNoteFeedProfileContext()
  /** Hex/npub ids can show npub fallback immediately; avoid a skeleton frame before the first effect. */
  const [isFetching, setIsFetching] = useState(() => {
    if (!id) return false
    const pk = userIdToPubkey(id)
    return !(pk.length === 64 && /^[0-9a-f]{64}$/.test(pk))
  })
  const [error, setError] = useState<Error | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const processingPubkeyRef = useRef<string | null>(null) // Track which pubkey we're currently processing (prevents duplicate fetches)
  const effectRunCountRef = useRef<Map<string, number>>(new Map()) // Track how many times effect has run for each pubkey (safety guard against infinite loops)
  const initializedPubkeysRef = useRef<Set<string>>(new Set()) // Track pubkeys we've successfully initialized (have profile or failed)

  // Function to check for profile updates with GLOBAL deduplication
  // fetchProfileEvent already checks: 1) IndexedDB, 2) network (with author's relays)
  // Memoize to prevent recreation on every render
  const checkProfile = useCallback(async (pubkey: string, cancelled: { current: boolean }): Promise<TProfile | null> => {
    // CRITICAL: Reduce logging during rapid scrolling to prevent performance issues
    // Only log at debug level during normal operations
    logger.debug('[useFetchProfile] checkProfile called', {
      pubkey: pubkey.substring(0, 8),
      cancelled: cancelled.current,
      skipCache
    })
    
    if (cancelled.current) {
      logger.debug('[useFetchProfile] Already cancelled, returning null')
      return null
    }
    
    // CRITICAL: Check cooldown period first to prevent cascade of duplicate fetches after timeout
    const cooldownExpiry = globalFetchCooldowns.get(pubkey)
    if (cooldownExpiry && Date.now() < cooldownExpiry) {
      logger.debug('[useFetchProfile] In cooldown period after timeout, skipping fetch', {
        pubkey: pubkey.substring(0, 8),
        remainingMs: cooldownExpiry - Date.now()
      })
      return null
    }
    // Clean up expired cooldowns
    if (cooldownExpiry && Date.now() >= cooldownExpiry) {
      globalFetchCooldowns.delete(pubkey)
    }
    
    // CRITICAL: Check if another hook instance is already fetching this pubkey
    // If so, wait for that fetch to complete instead of starting a new one
    // Add timeout protection to prevent infinite waits
    const existingPromise = globalFetchPromises.get(pubkey)
    if (existingPromise) {
      logger.debug('[useFetchProfile] Reusing existing fetch promise', {
        pubkey: pubkey.substring(0, 8)
      })
      try {
        // Await the shared promise only — it already races fetchProfileEvent with
        // PROFILE_FETCH_PROMISE_TIMEOUT_MS. Per-waiter Promise.race timers caused N identical
        // "timeout" warnings (one per mounted component) and premature map deletion.
        const existingProfile = await existingPromise
        if (cancelled.current) return null

        if (existingProfile) {
          // Update state for this instance
          setProfile(existingProfile)
          setIsFetching(false)
          initializedPubkeysRef.current.add(pubkey)
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
          }
          effectRunCountRef.current.delete(pubkey)
          return existingProfile
        } else {
          setIsFetching(false)
          return null
        }
      } catch (err) {
        // If the existing promise failed, we'll try again below
        logger.debug('[useFetchProfile] Existing promise failed, will retry', {
          pubkey: pubkey.substring(0, 8),
          error: err instanceof Error ? err.message : String(err)
        })
        // Clear the failed promise so we can start fresh
        globalFetchPromises.delete(pubkey)
        globalFetchingPubkeys.delete(pubkey)
      }
    }
    
    // Mark as fetching globally to prevent other instances from starting
    if (globalFetchingPubkeys.has(pubkey)) {
      // Another instance is fetching, wait a bit and check again
      await new Promise(resolve => setTimeout(resolve, 50))
      const retryPromise = globalFetchPromises.get(pubkey)
      if (retryPromise) {
        try {
          const retryProfile = await retryPromise
          if (cancelled.current) return null

          if (retryProfile) {
            // Update state for this instance
            setProfile(retryProfile)
            setIsFetching(false)
            initializedPubkeysRef.current.add(pubkey)
            if (checkIntervalRef.current) {
              clearInterval(checkIntervalRef.current)
              checkIntervalRef.current = null
            }
            effectRunCountRef.current.delete(pubkey)
            return retryProfile
          } else {
            setIsFetching(false)
            return null
          }
        } catch (err) {
          logger.debug('[useFetchProfile] Retry promise failed', {
            pubkey: pubkey.substring(0, 8),
            error: err instanceof Error ? err.message : String(err)
          })
          // Clear the failed promise
          globalFetchPromises.delete(pubkey)
          globalFetchingPubkeys.delete(pubkey)
          // Fall through to start our own fetch
        }
      }
    }
    
    // Create a new fetch promise with timeout protection
    const fetchPromise = (async (): Promise<TProfile | null> => {
      try {
        globalFetchingPubkeys.add(pubkey)
        const startTime = Date.now()
        
        // CRITICAL: Add timeout to prevent infinite hangs (must exceed batched metadata query globalTimeout)
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `Profile fetch timeout after ${PROFILE_FETCH_PROMISE_TIMEOUT_MS}ms for pubkey ${pubkey.substring(0, 8)}`
              )
            )
          }, PROFILE_FETCH_PROMISE_TIMEOUT_MS)
        })
        
        // Use fetchProfileEvent which includes author's relay list for better profile discovery
        const profileEvent = await Promise.race([
          replaceableEventService.fetchProfileEvent(pubkey, skipCache),
          timeoutPromise
        ])
        const fetchTime = Date.now() - startTime
        
        if (profileEvent || fetchTime > 1000) {
          logger.debug('[useFetchProfile] fetchProfileEvent completed', {
            pubkey: pubkey.substring(0, 8),
            hasEvent: !!profileEvent,
            eventId: profileEvent?.id?.substring(0, 8),
            fetchTime: `${fetchTime}ms`
          })
        }

        if (profileEvent) {
          // getProfileFromEvent always returns a profile object (with fallback username)
          const newProfile = getProfileFromEvent(profileEvent)
          // Only log at debug level to reduce noise during rapid scrolling
          logger.debug('[useFetchProfile] Profile found', {
            pubkey: pubkey.substring(0, 8),
            username: newProfile.username,
            hasAvatar: !!newProfile.avatar,
            fetchTime: `${fetchTime}ms`,
            unmounted: cancelled.current
          })
          // CRITICAL: Always return the profile from this shared promise, even when the
          // originating hook cleaned up (list virtualization, Strict Mode, feed switch).
          // Returning null here made every waiter treat the result like a timeout, applied
          // cooldowns, and left avatars empty (especially busy feeds e.g. all-favorites).
          return newProfile
        }
        // Only log warnings for missing profiles if skipCache is true (user explicitly requested)
        if (skipCache) {
          logger.debug('[useFetchProfile] No profile event found', {
            pubkey: pubkey.substring(0, 8),
            fetchTime: `${fetchTime}ms`
          })
        }
        return null
      } catch (err) {
        const isTimeout = err instanceof Error && err.message.includes('timeout')
        if (isTimeout) {
          logger.debug('[useFetchProfile] Profile fetch timed out', {
            pubkey: pubkey.substring(0, 8),
            error: err.message
          })
          // Set cooldown period after timeout to prevent cascade of duplicate fetches
          globalFetchCooldowns.set(pubkey, Date.now() + 10000) // 10 second cooldown
          // Return null on timeout instead of throwing - allows UI to show fallback
          return null
        }
        logger.error('[useFetchProfile] Profile fetch error', {
          pubkey: pubkey.substring(0, 8),
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          cancelled: cancelled.current
        })
        // For non-timeout errors, still throw to allow retry logic
        throw err
      } finally {
        // Clean up global tracking
        globalFetchingPubkeys.delete(pubkey)
        // Keep promise in cache for a short time to allow other instances to reuse it
        // But remove it immediately on timeout/error to allow retries
        setTimeout(() => {
          globalFetchPromises.delete(pubkey)
        }, 1000) // 1 second cache retention
      }
    })()
    
    // Store the promise globally so other instances can reuse it
    globalFetchPromises.set(pubkey, fetchPromise)
    
    try {
      const profile = await fetchPromise
      if (cancelled.current) return null
      
      if (profile) {
        setProfile(profile)
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
        return profile
      }
      
      if (!cancelled.current) {
        setIsFetching(false)
      }
      return null
    } catch (err) {
      if (!cancelled.current) {
        setError(err as Error)
        setIsFetching(false)
      }
      return null
    }
  }, [skipCache])

  useEffect(() => {
    // Early exit when id is missing (e.g. truncated or undefined) - use debug to avoid console spam
    if (!id) {
      logger.debug('[useFetchProfile] No id provided')
      setProfile(null)
      setPubkey(null)
      setIsFetching(false)
      setError(new Error('No id provided'))
      processingPubkeyRef.current = null
      return
    }

    // Extract pubkey early to check if id has changed
    const extractedPubkey = userIdToPubkey(id)

    // Note feeds: profiles are batch-fetched in NoteList — skip per-row relay storms while pending
    if (extractedPubkey && noteFeed && !skipCache) {
      const fromBatch = noteFeed.profiles.get(extractedPubkey)
      if (fromBatch) {
        setProfile(fromBatch)
        setPubkey(extractedPubkey)
        setIsFetching(false)
        setError(null)
        processingPubkeyRef.current = extractedPubkey
        initializedPubkeysRef.current.add(extractedPubkey)
        effectRunCountRef.current.delete(extractedPubkey)
        return
      }
      if (noteFeed.pendingPubkeys.has(extractedPubkey)) {
        setPubkey(extractedPubkey)
        setIsFetching(false)
        setError(null)
        return
      }
    }
    
    // CRITICAL: Early exit if already processing this exact pubkey - prevents infinite loops
    // This check must happen FIRST, before any other logic
    // Set processingPubkeyRef IMMEDIATELY after extraction to prevent race conditions
    if (extractedPubkey) {
      if (processingPubkeyRef.current === extractedPubkey) {
        // Silently exit - no logging to reduce noise
        return
      }
      // Mark that we're processing this pubkey IMMEDIATELY to prevent concurrent runs
      // We'll clear it later if we early exit for other reasons
      processingPubkeyRef.current = extractedPubkey
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
    if (extractedPubkey && initializedPubkeysRef.current.has(extractedPubkey) && !profile) {
      if (skipCache) {
        // User wants to refresh - clear initialized flag to allow fresh fetch
        initializedPubkeysRef.current.delete(extractedPubkey)
        // Also clear run count to allow fresh attempt
        effectRunCountRef.current.delete(extractedPubkey)
      } else {
        // Already tried and failed - don't retry unless explicitly requested
        // Ensure fetching is false
        if (isFetching) {
          setIsFetching(false)
        }
        return
      }
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
    
    const cancelled = { current: false }
    // CRITICAL: Reduce logging during rapid scrolling - only log at debug level
    logger.debug('[useFetchProfile] Extracting pubkey', {
      idLength: id.length,
      idStartsWithNpub: id.startsWith('npub1'),
      idStartsWithNprofile: id.startsWith('nprofile1')
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
    // Keeping this as a safety check, but it should rarely be hit now that we set processingPubkeyRef earlier
    if (processingPubkeyRef.current !== extractedPubkey) {
      // This should never happen now, but keep as safety check
      logger.warn('[useFetchProfile] processingPubkeyRef mismatch (safety check)', {
        extractedPubkey,
        processingPubkey: processingPubkeyRef.current
      })
      processingPubkeyRef.current = extractedPubkey
    }
    
    if (profile && profile.pubkey === extractedPubkey) {
      logger.debug('[useFetchProfile] Already have profile for this pubkey (safety check)', {
        extractedPubkey
      })
      setIsFetching(false)
      effectRunCountRef.current.delete(extractedPubkey)
      return
    }
    
    // processingPubkeyRef is already set earlier (right after extraction)
    // No need to set it again here
    
    // CRITICAL: Only update pubkey state if it's actually different
    // Avoid state updates that could trigger re-renders and loops
    if (pubkey !== extractedPubkey) {
      setPubkey(extractedPubkey)
    }
    // CRITICAL: Reduce logging during rapid scrolling
    logger.debug('[useFetchProfile] Starting profile fetch', {
      pubkey: extractedPubkey?.substring(0, 8) || 'null'
    })

    const run = async () => {
      try {
        setIsFetching(true)
        setError(null)
        
        // Initial fetch - fetchReplaceableEvent checks: 1) in-memory, 2) IndexedDB, 3) network
        // checkProfile now returns the profile directly (or null) and handles global deduplication
        const profile = await checkProfile(extractedPubkey, cancelled)
        
        // Only log if profile was found or if cancelled (important events)
        if (profile || cancelled.current) {
          logger.debug('[useFetchProfile] checkProfile completed', {
            pubkey: extractedPubkey?.substring(0, 8),
            found: !!profile,
            cancelled: cancelled.current
          })
        }
        
        if (cancelled.current) {
          logger.debug('[useFetchProfile] Cancelled after checkProfile, cleaning up')
          setIsFetching(false)
          return
        }
        
        if (profile) {
          // Profile found (from cache or network), we're done
          // checkProfile already set the profile state, so we're done
          return
        }
        
        logger.debug('[useFetchProfile] No profile found, considering retry')
        // No profile found yet - set fetching to false so UI can show fallback
        // The profile will remain null, allowing components to show npub fallback
        setIsFetching(false)
        setError(null) // Clear any previous errors
        
        // CRITICAL FIX: Disable retry intervals during rapid scrolling to prevent browser crashes
        // Only retry if skipCache is true (user explicitly wants to refresh)
        // For normal feed scrolling, missing profiles are acceptable and will be fetched on-demand
        // This prevents accumulation of hundreds of intervals during rapid scrolling
        if (skipCache) {
          // If no profile was found, periodically re-check (profiles might load asynchronously)
          // REDUCED: Check every 10 seconds for up to 30 seconds (3 checks) to prevent too many intervals
          // This reduces memory usage when many profiles are being fetched (e.g., trending page)
          let checkCount = 0
          const maxChecks = 3 // Reduced from 4 to further reduce load
          const startTime = Date.now()
          const maxTotalTime = 20000 // 20 seconds total timeout (3 checks * ~5s + buffer)
          
          checkIntervalRef.current = setInterval(async () => {
            // CRITICAL: Check for timeout to prevent infinite retries
            const elapsed = Date.now() - startTime
            if (elapsed > maxTotalTime) {
              logger.warn('[useFetchProfile] Retry interval timeout reached, stopping retries', {
                pubkey: extractedPubkey?.substring(0, 8),
                elapsed: `${elapsed}ms`
              })
              if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
              }
              return
            }
            
            if (cancelled.current || checkCount >= maxChecks) {
              if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
              }
              return
            }
            
            checkCount++
            const profile = await checkProfile(extractedPubkey, cancelled)
            if (profile || cancelled.current) {
              // Profile found or cancelled, stop checking
              if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
              }
            }
          }, 10000) // Increased from 5 seconds to 10 seconds to reduce load
        } else {
          // For normal feed scrolling, don't set up retry intervals
          // Profiles will be fetched on-demand when user navigates to profile page
          // This prevents accumulation of intervals during rapid scrolling
          logger.debug('[useFetchProfile] Skipping retry intervals for normal feed scrolling', {
            pubkey: extractedPubkey
          })
        }
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

    logger.debug('[useFetchProfile] About to call run()', {
      pubkey: extractedPubkey?.substring(0, 8)
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
      // CRITICAL: Always clear interval on cleanup to prevent memory leaks
      // This is especially important during rapid scrolling when many components mount/unmount
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
        checkIntervalRef.current = null
      }
      // Clear run count and initialized status on cleanup to allow fresh fetches if component remounts
      if (extractedPubkey) {
        effectRunCountRef.current.delete(extractedPubkey)
        // Don't clear initializedPubkeysRef here - keep it to prevent re-fetching on remount
        // Only clear it if explicitly requested via skipCache
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, skipCache, noteFeed?.version]) // checkProfile is memoized; noteFeed.version hydrates batch profiles

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
