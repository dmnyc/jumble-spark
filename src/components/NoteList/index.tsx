import NewNotesButton from '@/components/NewNotesButton'
import { Button } from '@/components/ui/button'
import { ExtendedKind } from '@/constants'
import {
  getEmbeddedNoteBech32Ids,
  getReplaceableCoordinateFromEvent,
  isMentioningMutedUsers,
  isReplaceableEvent,
  isReplyNoteEvent
} from '@/lib/event'
import { shouldFilterEvent } from '@/lib/event-filtering'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { isTouchDevice } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { useZap } from '@/providers/ZapProvider'
import client from '@/services/client.service'
import { TFeedSubRequest } from '@/types'
import dayjs from 'dayjs'
import { Event, kinds } from 'nostr-tools'
import { decode } from 'nostr-tools/nip19'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import PullToRefresh from 'react-simple-pull-to-refresh'
import NoteCard, { NoteCardLoadingSkeleton } from '../NoteCard'

const LIMIT = 500 // Increased from 200 to load more events per request
const ALGO_LIMIT = 1000 // Increased from 500 for algorithm feeds
const SHOW_COUNT = 50 // Increased from 10 to show more events at once, reducing scroll load frequency

const NoteList = forwardRef(
  (
    {
      subRequests,
      showKinds,
      showKind1OPs = true,
      showKind1Replies = true,
      showKind1111 = true,
      filterMutedNotes = true,
      hideReplies = false,
      hideUntrustedNotes = false,
      areAlgoRelays = false,
      pinnedEventIds = [],
      useFilterAsIs = false,
      extraShouldHideEvent
    }: {
      subRequests: TFeedSubRequest[]
      showKinds: number[]
      showKind1OPs?: boolean
      showKind1Replies?: boolean
      showKind1111?: boolean
      filterMutedNotes?: boolean
      hideReplies?: boolean
      hideUntrustedNotes?: boolean
      areAlgoRelays?: boolean
      pinnedEventIds?: string[]
      /** When true, use filter from subRequests as-is (kinds, limit) instead of showKinds. For spell feeds. */
      useFilterAsIs?: boolean
      /** When provided and returns true, the event is omitted from the feed (in addition to built-in rules). */
      extraShouldHideEvent?: (evt: Event) => boolean
    },
    ref
  ) => {
    const { t } = useTranslation()
    const { startLogin, pubkey } = useNostr()
    const { isUserTrusted } = useUserTrust()
    const { mutePubkeySet } = useMuteList()
    const { hideContentMentioningMutedUsers } = useContentPolicy()
    const { isEventDeleted } = useDeletedEvent()
    const { zapReplyThreshold } = useZap()
    const [events, setEvents] = useState<Event[]>([])
    const [newEvents, setNewEvents] = useState<Event[]>([])
    const [hasMore, setHasMore] = useState<boolean>(true)
    const [loading, setLoading] = useState(true)
    const [timelineKey, setTimelineKey] = useState<string | undefined>(undefined)
    const [refreshCount, setRefreshCount] = useState(0)
    const [showCount, setShowCount] = useState(SHOW_COUNT)
    const supportTouch = useMemo(() => isTouchDevice(), [])
    const bottomRef = useRef<HTMLDivElement | null>(null)
    const topRef = useRef<HTMLDivElement | null>(null)
    const consecutiveEmptyRef = useRef(0) // Track consecutive empty results to prevent infinite retries
    const loadMoreTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Throttle loadMore calls to prevent stuttering
    
    // Memoize subRequests serialization to avoid expensive JSON.stringify on every render
    const subRequestsKey = useMemo(() => {
      return JSON.stringify(subRequests.map(req => ({
        urls: [...req.urls].sort(), // Create a copy before sorting to avoid mutation
        filter: req.filter
      })))
    }, [subRequests])

    // Stable key for kind filter so subscription effect doesn't re-run on parent re-renders with same kinds
    // Use sorted array and JSON.stringify to create a stable key that only changes when content changes
    const showKindsKey = useMemo(() => {
      if (!showKinds || showKinds.length === 0) return ''
      return JSON.stringify([...showKinds].sort((a, b) => a - b))
    }, [showKinds])

    const shouldHideEvent = useCallback(
      (evt: Event) => {
        const pinnedEventHexIdSet = new Set()
        pinnedEventIds.forEach((id) => {
          try {
            const { type, data } = decode(id)
            if (type === 'nevent') {
              pinnedEventHexIdSet.add(data.id)
            }
          } catch {
            // ignore
          }
        })

        if (pinnedEventHexIdSet.has(evt.id)) return true
        if (isEventDeleted(evt)) return true
        if (hideReplies && isReplyNoteEvent(evt)) return true
        if (hideUntrustedNotes && !isUserTrusted(evt.pubkey)) return true
        if (filterMutedNotes && mutePubkeySet.has(evt.pubkey)) return true
        if (
          filterMutedNotes &&
          hideContentMentioningMutedUsers &&
          isMentioningMutedUsers(evt, mutePubkeySet)
        ) {
          return true
        }

        // Filter out expired events
        if (shouldFilterEvent(evt)) return true

        // Filter out zap receipts below the zap threshold (superzaps)
        if (evt.kind === ExtendedKind.ZAP_RECEIPT) {
          const zapInfo = getZapInfoFromEvent(evt)
          // Hide zap receipts if amount is missing, 0, or below the threshold
          if (!zapInfo || zapInfo.amount === undefined || zapInfo.amount === 0 || zapInfo.amount < zapReplyThreshold) {
            return true
          }
        }

        if (extraShouldHideEvent?.(evt)) return true

        return false
      },
      [
        hideReplies,
        hideUntrustedNotes,
        mutePubkeySet,
        pinnedEventIds,
        isEventDeleted,
        zapReplyThreshold,
        extraShouldHideEvent
      ]
    )

    const shouldHideEventRef = useRef(shouldHideEvent)
    useEffect(() => {
      shouldHideEventRef.current = shouldHideEvent
    }, [shouldHideEvent])

    const filteredEvents = useMemo(() => {
      const idSet = new Set<string>()

      return events.slice(0, showCount).filter((evt) => {
        if (!showKinds.includes(evt.kind)) return false
        // Kind 1: show only OPs if showKind1OPs, only replies if showKind1Replies
        if (evt.kind === kinds.ShortTextNote) {
          const isReply = isReplyNoteEvent(evt)
          if (isReply && !showKind1Replies) return false
          if (!isReply && !showKind1OPs) return false
        }
        // Kind 1111 (comments): show only if showKind1111
        if (evt.kind === ExtendedKind.COMMENT && !showKind1111) return false
        if (shouldHideEvent(evt)) return false

        const id = isReplaceableEvent(evt.kind) ? getReplaceableCoordinateFromEvent(evt) : evt.id
        if (idSet.has(id)) {
          return false
        }
        idSet.add(id)
        return true
      })
    }, [events, showCount, shouldHideEvent, showKinds, showKind1OPs, showKind1Replies, showKind1111])

    const filteredNewEvents = useMemo(() => {
      const idSet = new Set<string>()

      return newEvents.filter((event: Event) => {
        if (!showKinds.includes(event.kind)) return false
        if (event.kind === kinds.ShortTextNote) {
          const isReply = isReplyNoteEvent(event)
          if (isReply && !showKind1Replies) return false
          if (!isReply && !showKind1OPs) return false
        }
        if (event.kind === ExtendedKind.COMMENT && !showKind1111) return false
        if (shouldHideEvent(event)) return false

        const id = isReplaceableEvent(event.kind)
          ? getReplaceableCoordinateFromEvent(event)
          : event.id
        if (idSet.has(id)) {
          return false
        }
        idSet.add(id)
        return true
      })
    }, [newEvents, shouldHideEvent, showKinds, showKind1OPs, showKind1Replies, showKind1111])

    const scrollToTop = (behavior: ScrollBehavior = 'instant') => {
      setTimeout(() => {
        topRef.current?.scrollIntoView({ behavior, block: 'start' })
      }, 20)
    }

    const refresh = () => {
      scrollToTop()
      setTimeout(() => {
        setRefreshCount((count) => count + 1)
      }, 500)
    }

    useImperativeHandle(ref, () => ({ scrollToTop, refresh }), [])

    useEffect(() => {
      if (!subRequests.length) {
        setLoading(false)
        setEvents([])
        // Return a no-op closer function to satisfy the cleanup function
        return () => {}
      }

      /** False after cleanup so stale timeline callbacks cannot overwrite state after switching feeds (e.g. Spells discussions → notifications). */
      let effectActive = true

      async function init() {
        setLoading(true)
        setEvents([])
        setNewEvents([])
        setHasMore(true)
        consecutiveEmptyRef.current = 0 // Reset counter on refresh

        const mappedSubRequests = subRequests.map(({ urls, filter }) => {
          // CRITICAL: Always ensure filter has kinds - relays require this to return events
          const defaultKinds = showKinds.length > 0 ? showKinds : [kinds.ShortTextNote]
          const finalFilter = useFilterAsIs
            ? {
                ...filter,
                // If filter doesn't have kinds, add them (required for relay queries)
                kinds: filter.kinds && filter.kinds.length > 0 ? filter.kinds : defaultKinds,
                limit: filter.limit ?? (areAlgoRelays ? ALGO_LIMIT : LIMIT)
              }
            : {
                ...filter,
                // If showKinds is empty, default to kind 1 (ShortTextNote) only
                kinds: defaultKinds,
                limit: areAlgoRelays ? ALGO_LIMIT : LIMIT
              }
          
          // CRITICAL: Validate filter has kinds before subscribing
          if (!finalFilter.kinds || finalFilter.kinds.length === 0) {
            finalFilter.kinds = [kinds.ShortTextNote]
          }
          
          return { urls, filter: finalFilter }
        })
        
        // CRITICAL: Validate all filters have kinds before subscribing
        const invalidFilters = mappedSubRequests.filter(({ filter }) => !filter.kinds || filter.kinds.length === 0)
        if (invalidFilters.length > 0) {
          // Don't subscribe with invalid filters - this would return no events
          setLoading(false)
          setEvents([])
          // Return a no-op closer function to satisfy the cleanup function
          return () => {}
        }

        let closer: (() => void) | undefined
        let timelineKey: string | undefined
        let timelineSubscribePromise:
          | Promise<{ closer: () => void; timelineKey: string }>
          | undefined

        try {
          // Add timeout wrapper to prevent subscribeTimeline from hanging indefinitely
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error('subscribeTimeline timeout after 5 seconds'))
            }, 5000) // 5 second timeout
          })
          
          timelineSubscribePromise = client.subscribeTimeline(
            mappedSubRequests,
            {
              onEvents: (events: Event[], eosed: boolean) => {
                if (!effectActive) return
                if (events.length > 0) {
                  setEvents(events)
                  // Do not wait for full EOSE across many relays — otherwise loading/skeleton stays up for 10–30s+
                  setLoading(false)
                  
                  // CRITICAL: Prefetch profiles for initial events (optimized for faster initial load)
                  // Only prefetch for first 50 events to reduce initial load time
                  // Additional prefetching happens on scroll via the useEffect hooks
                  const initialPubkeys = Array.from(
                    new Set(events.slice(0, 50).map((ev: Event) => ev.pubkey).filter((p: string) => p?.length === 64))
                  )
                  if (initialPubkeys.length > 0) {
                    // Filter out already prefetched pubkeys
                    const pubkeysToFetch = initialPubkeys.filter((p) => !prefetchedPubkeysRef.current.has(p))
                    if (pubkeysToFetch.length > 0) {
                      // Mark as prefetched immediately to prevent duplicate requests
                      pubkeysToFetch.forEach((p) => prefetchedPubkeysRef.current.add(p))
                      // Batch fetch in background (non-blocking) with delay to not block initial render
                      setTimeout(() => {
                        if (!effectActive) return
                        client.fetchProfilesForPubkeys(pubkeysToFetch).catch(() => {
                          // On error, remove from prefetched set so we can retry later
                          pubkeysToFetch.forEach((p) => prefetchedPubkeysRef.current.delete(p))
                        })
                      }, 100)
                    }
                  }
                  
                  // CRITICAL: Prefetch embedded events for initial events (reduced scope)
                  // Only prefetch for first 50 events to reduce initial load time
                  const initialEmbeddedEventIds = new Set<string>()
                  events.slice(0, 50).forEach((ev: Event) => {
                    const embeddedIds = extractEmbeddedEventIds(ev)
                    embeddedIds.forEach((id: string) => initialEmbeddedEventIds.add(id))
                  })
                  const eventIdsToFetch = Array.from(initialEmbeddedEventIds).filter(
                    (id) => !prefetchedEventIdsRef.current.has(id)
                  )
                  if (eventIdsToFetch.length > 0) {
                    // Mark as prefetched immediately to prevent duplicate requests
                    eventIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.add(id))
                    // Batch fetch embedded events in background (non-blocking) with delay
                    setTimeout(() => {
                      if (!effectActive) return
                      Promise.all(eventIdsToFetch.map((id) => client.fetchEvent(id))).catch(() => {
                        // On error, remove from prefetched set so we can retry later
                        eventIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.delete(id))
                      })
                    }, 200)
                  }
                } else if (eosed) {
                  // No events received but EOSE - set empty events array and stop loading
                  setEvents([])
                  setLoading(false)
                }
                
                if (areAlgoRelays) {
                  // Algorithm feeds typically return all results at once
                  setHasMore(false)
                } else if (eosed) {
                  setLoading(false)
                  // CRITICAL FIX: For non-algo feeds, always assume there might be more events
                  // The initial load might only return a few events due to filtering or relay limits
                  // We should still try to load more on scroll - the loadMore logic will handle stopping
                  // Only set to false if we explicitly know there are no more events (handled in loadMore)
                  // If we got a full limit of events, there's likely more available
                  if (events.length >= (areAlgoRelays ? ALGO_LIMIT : LIMIT)) {
                    setHasMore(true)
                  } else {
                    // Even with fewer events, there might be more (filtering, slow relays, etc.)
                    // Let loadMore determine if we've reached the end
                    setHasMore(true)
                  }
                }
              },
            onNew: (event: Event) => {
              if (!effectActive) return
              if (!useFilterAsIs && !showKinds.includes(event.kind)) return
              if (event.kind === kinds.ShortTextNote) {
                const isReply = isReplyNoteEvent(event)
                if (isReply && !showKind1Replies) return
                if (!isReply && !showKind1OPs) return
              }
              if (event.kind === ExtendedKind.COMMENT && !showKind1111) return
              if (shouldHideEventRef.current(event)) return
              if (pubkey && event.pubkey === pubkey) {
                // If the new event is from the current user, insert it directly into the feed
                setEvents((oldEvents) =>
                  oldEvents.some((e) => e.id === event.id) ? oldEvents : [event, ...oldEvents]
                )
              } else {
                // Otherwise, buffer it and show the New Notes button
                setNewEvents((oldEvents) =>
                  [event, ...oldEvents].sort((a, b) => b.created_at - a.created_at)
                )
              }
            },
          },
          {
            startLogin,
            needSort: !areAlgoRelays,
            useCache: false // Main feeds should always fetch fresh from relays, not use cache
          }
          )

          const result = await Promise.race([timelineSubscribePromise, timeoutPromise])
          if (!effectActive) {
            result.closer()
            return () => {}
          }
          closer = result.closer
          timelineKey = result.timelineKey
        setTimelineKey(timelineKey)
        return closer
      } catch (_error) {
        setLoading(false)
        // Race timeout or subscribe failure: if the timeline promise later resolves, close or subs leak (relay slots + stale setEvents).
        if (timelineSubscribePromise) {
          void timelineSubscribePromise
            .then((r) => {
              r.closer()
            })
            .catch(() => {})
        }
        return () => {}
      }
      }

      const promise = init()
      return () => {
        effectActive = false
        promise.then((closer) => closer?.())
      }
    }, [
      subRequestsKey,
      refreshCount,
      showKindsKey,
      showKind1OPs,
      showKind1Replies,
      showKind1111,
      useFilterAsIs,
      areAlgoRelays
    ])

    // Use refs to avoid dependency issues and ensure latest values in async callbacks
    const eventsRef = useRef(events)
    const showCountRef = useRef(showCount)
    const loadingRef = useRef(loading)
    const hasMoreRef = useRef(hasMore)
    const timelineKeyRef = useRef(timelineKey)
    
    useEffect(() => {
      eventsRef.current = events
    }, [events])
    
    useEffect(() => {
      showCountRef.current = showCount
    }, [showCount])
    
    useEffect(() => {
      loadingRef.current = loading
    }, [loading])
    
    useEffect(() => {
      hasMoreRef.current = hasMore
    }, [hasMore])
    
    useEffect(() => {
      timelineKeyRef.current = timelineKey
    }, [timelineKey])

    useEffect(() => {
      const options: IntersectionObserverInit = {
        root: null,
        // Trigger when user is 400px from the bottom so we start loading before they reach the end
        rootMargin: '0px 0px 400px 0px',
        threshold: 0
      }

      const loadMore = async (): Promise<void> => {
        const currentEvents = eventsRef.current
        const currentShowCount = showCountRef.current
        const currentLoading = loadingRef.current
        const currentHasMore = hasMoreRef.current
        const currentTimelineKey = timelineKeyRef.current
        
        // CRITICAL: Throttle loadMore calls to prevent stuttering during rapid scrolling
        if (loadMoreTimeoutRef.current) {
          return // Already scheduled, skip
        }
        
        // Show more events immediately if we have them cached
        if (currentShowCount < currentEvents.length) {
          // Show more aggressively: increase by SHOW_COUNT, but also check if we should show even more
          const remaining = currentEvents.length - currentShowCount
          const increment = Math.min(SHOW_COUNT * 2, remaining) // Show up to 2x SHOW_COUNT if available
          setShowCount((prev) => prev + increment)
          // Only preload more if we have plenty cached (more than 3/4 of LIMIT)
          // BUT: Always try to load more if we have very few events (might be due to filtering)
          if (currentEvents.length - currentShowCount > LIMIT * 0.75 && currentEvents.length >= 50) {
            return
          }
          // If we have very few events, always try to load more (might be aggressive filtering)
          if (currentEvents.length < 50) {
            // Continue to loadMore below even if we have cached events
            // This ensures we keep loading when filtering is aggressive
          }
        }

        if (!currentTimelineKey || currentLoading || !currentHasMore) return
        
        // Schedule loadMore with a small delay to throttle rapid calls
        loadMoreTimeoutRef.current = setTimeout(async () => {
          loadMoreTimeoutRef.current = null
          const latestEvents = eventsRef.current
          const latestTimelineKey = timelineKeyRef.current
          const latestLoading = loadingRef.current
          const latestHasMore = hasMoreRef.current
          
          if (!latestTimelineKey || latestLoading || !latestHasMore) return
          
          setLoading(true)
          let newEvents: Event[] = []
          try {
            const until = latestEvents.length ? latestEvents[latestEvents.length - 1].created_at - 1 : dayjs().unix()
            newEvents = await client.loadMoreTimeline(
              latestTimelineKey,
              until,
              LIMIT
            )
            
            // CRITICAL FIX: Be extremely conservative about stopping the feed
            // Only stop if we're absolutely certain there are no more events
            if (newEvents.length === 0) {
              // Check if timeline has more cached refs that we haven't loaded yet
              const hasMoreCached = client.hasMoreTimelineEvents?.(latestTimelineKey, until) ?? false
              
              if (hasMoreCached) {
                // There are more cached events, keep hasMore true and try again
                setLoading(false)
                // Retry after a short delay to allow IndexedDB to catch up
                setTimeout(() => {
                  if (hasMoreRef.current && !loadingRef.current) {
                    loadMore()
                  }
                }, 300)
                return
              }
              
              // No cached events and network returned empty
              // Be VERY patient - don't stop too early, especially when we have few events
              // This prevents stopping due to temporary relay issues or slow relays
              consecutiveEmptyRef.current += 1
              
              // CRITICAL FIX: Only stop if we have MANY consecutive empty results AND we have a reasonable number of events
              // This ensures we don't stop prematurely when relays are slow or filtering is aggressive
              // If we have very few events (< 50), keep trying longer in case filtering is aggressive
              const eventCount = latestEvents.length
              const shouldStop = consecutiveEmptyRef.current >= (eventCount < 50 ? 30 : 15)
              
              if (shouldStop) {
                // After many consecutive empty results, assume we've reached the end
                setHasMore(false)
              }
              // Otherwise, keep hasMore true to allow retry on next scroll
              // This ensures the feed continues trying even if relays are slow
              setLoading(false)
              return
            }
            
            // Reset consecutive empty counter on success
            consecutiveEmptyRef.current = 0
            
            setEvents((oldEvents) => [...oldEvents, ...newEvents])
            
            // After appending, the bottom sentinel may have moved below the fold. Re-check after
            // paint: if it's still in/near view, trigger loadMore again so user doesn't have to scroll.
            setTimeout(() => {
              const bottomEl = bottomRef.current
              if (bottomEl && hasMoreRef.current && !loadingRef.current) {
                const rect = bottomEl.getBoundingClientRect()
                if (rect.top < window.innerHeight + 200) {
                  loadMore()
                }
              }
            }, 150)
            
            // NEVER automatically set hasMore to false based on result count
            // Only stop when we get consecutive empty results
            // This ensures the feed continues loading even with partial results
            
            // CRITICAL: Prefetch profiles for newly loaded events (optimized to reduce stuttering)
            // Only prefetch if we're not currently loading to avoid blocking scroll
            if (newEvents.length > 0 && !loadingRef.current) {
              // Use requestIdleCallback if available, otherwise setTimeout with longer delay
              const schedulePrefetch = (callback: () => void) => {
                if (typeof requestIdleCallback !== 'undefined') {
                  requestIdleCallback(callback, { timeout: 500 })
                } else {
                  setTimeout(callback, 300)
                }
              }
              
              schedulePrefetch(() => {
                const newPubkeys = Array.from(
                  new Set(newEvents.map((ev) => ev.pubkey).filter((p) => p?.length === 64))
                )
                if (newPubkeys.length > 0) {
                  // Filter out already prefetched pubkeys
                  const pubkeysToFetch = newPubkeys.filter((p) => !prefetchedPubkeysRef.current.has(p))
                  if (pubkeysToFetch.length > 0) {
                    // Mark as prefetched immediately to prevent duplicate requests
                    pubkeysToFetch.forEach((p) => prefetchedPubkeysRef.current.add(p))
                    // Batch fetch in background (non-blocking)
                    client.fetchProfilesForPubkeys(pubkeysToFetch).catch(() => {
                      // On error, remove from prefetched set so we can retry later
                      pubkeysToFetch.forEach((p) => prefetchedPubkeysRef.current.delete(p))
                    })
                  }
                }
                
                // CRITICAL: Prefetch embedded events for newly loaded events (throttled)
                const newEmbeddedEventIds = new Set<string>()
                // Only prefetch for first 30 events to reduce load
                newEvents.slice(0, 30).forEach((ev) => {
                  const embeddedIds = extractEmbeddedEventIds(ev)
                  embeddedIds.forEach((id) => newEmbeddedEventIds.add(id))
                })
                const eventIdsToFetch = Array.from(newEmbeddedEventIds).filter(
                  (id) => !prefetchedEventIdsRef.current.has(id)
                )
                if (eventIdsToFetch.length > 0) {
                  // Mark as prefetched immediately to prevent duplicate requests
                  eventIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.add(id))
                  // Batch fetch embedded events in background (non-blocking)
                  Promise.all(eventIdsToFetch.map((id) => client.fetchEvent(id))).catch(() => {
                    // On error, remove from prefetched set so we can retry later
                    eventIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.delete(id))
                  })
                }
              })
            }
          } catch (_error) {
            // On error, don't set hasMore to false - might be temporary network issue
            consecutiveEmptyRef.current += 1
            // Only stop after MANY consecutive errors - be very patient with network issues
            // This prevents stopping when relays are temporarily down or slow
            if (consecutiveEmptyRef.current >= 25) {
              // Increased from 15 to 25 to be even more patient with network issues
              setHasMore(false)
            }
          } finally {
            setLoading(false)
          }
        }, 50) // Reduced delay from 100ms to 50ms for more responsive scrolling
      }

      const observerInstance = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMoreRef.current && !loadingRef.current) {
          // Throttle: only trigger if not already loading and not already scheduled
          loadMore()
        }
      }, options)

      const currentBottomRef = bottomRef.current

      if (currentBottomRef) {
        observerInstance.observe(currentBottomRef)
      }

      return () => {
        if (observerInstance && currentBottomRef) {
          observerInstance.unobserve(currentBottomRef)
        }
        // Clean up timeout on unmount
        if (loadMoreTimeoutRef.current) {
          clearTimeout(loadMoreTimeoutRef.current)
          loadMoreTimeoutRef.current = null
        }
      }
    // Dependencies are handled via refs to avoid stale closures in async callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // CRITICAL: Prefetch profiles for visible authors + upcoming events in one batched request
    // This prevents browser crashes during rapid scrolling by pre-loading profiles before they're needed
    const visiblePubkeysRef = useRef<Set<string>>(new Set())
    const prefetchedPubkeysRef = useRef<Set<string>>(new Set())
    const prefetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    
    // CRITICAL: Prefetch embedded events (referenced in e tags, a tags, and content)
    // This ensures embedded events are ready before user scrolls to them
    const prefetchedEventIdsRef = useRef<Set<string>>(new Set())
    const prefetchEmbeddedEventsTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    
    // Helper function to extract all embedded event IDs from an event
    const extractEmbeddedEventIds = useCallback((evt: Event): string[] => {
      const eventIds: string[] = []
      
      // 1. Extract from 'e' tags (event references)
      evt.tags
        .filter((tag) => tag[0] === 'e' && tag[1] && tag[1].length === 64)
        .forEach((tag) => {
          const eventId = tag[1]
          if (eventId && /^[0-9a-f]{64}$/.test(eventId)) {
            eventIds.push(eventId)
          }
        })
      
      // 2. Extract from 'a' tags (addressable events) - get event ID if present
      evt.tags
        .filter((tag) => tag[0] === 'a' && tag[3]) // tag[3] is the event ID for version tracking
        .forEach((tag) => {
          const eventId = tag[3]
          if (eventId && /^[0-9a-f]{64}$/.test(eventId)) {
            eventIds.push(eventId)
          }
        })
      
      // 3. Extract from content (nostr: links)
      // Note: getEmbeddedNoteBech32Ids returns hex IDs (despite the name)
      const embeddedNoteIds = getEmbeddedNoteBech32Ids(evt)
      embeddedNoteIds.forEach((id) => {
        // The function already returns hex IDs, so use them directly
        if (id && /^[0-9a-f]{64}$/.test(id)) {
          eventIds.push(id)
        }
      })
      
      return Array.from(new Set(eventIds)) // Deduplicate
    }, [])
    
    useEffect(() => {
      // Throttle profile prefetching to reduce frequency during rapid scrolling
      // Clear any existing timeout
      if (prefetchTimeoutRef.current) {
        clearTimeout(prefetchTimeoutRef.current)
      }
      
      // Debounce profile prefetching by 300ms to reduce frequency during rapid scrolling
      prefetchTimeoutRef.current = setTimeout(() => {
        // Prefetch profiles for:
        // 1. Currently visible events (first 40, reduced to reduce stuttering)
        // 2. Upcoming events that will be visible when scrolling (next 80, reduced to reduce load)
        // This ensures profiles are ready before they're needed during rapid scrolling
        const visiblePubkeys = Array.from(
          new Set(filteredEvents.slice(0, 40).map((ev) => ev.pubkey).filter((p) => p?.length === 64))
        )
        const upcomingPubkeys = Array.from(
          new Set(events.slice(0, 80).map((ev) => ev.pubkey).filter((p) => p?.length === 64))
        )
        
        // Combine visible and upcoming, but prioritize visible ones
        const allPubkeys = Array.from(new Set([...visiblePubkeys, ...upcomingPubkeys]))
        
        if (allPubkeys.length === 0) return
        
        // Check if we've already prefetched these exact pubkeys
        const prev = visiblePubkeysRef.current
        const same = allPubkeys.length === prev.size && allPubkeys.every((p) => prev.has(p))
        if (same) return
        
        // Find pubkeys that haven't been prefetched yet
        const newPubkeys = allPubkeys.filter((p) => !prefetchedPubkeysRef.current.has(p))
        
        if (newPubkeys.length === 0) {
          // All pubkeys already prefetched, just update the ref
          visiblePubkeysRef.current = new Set(allPubkeys)
          return
        }
        
        // Update refs
        visiblePubkeysRef.current = new Set(allPubkeys)
        newPubkeys.forEach((p) => prefetchedPubkeysRef.current.add(p))
        
        // Batch fetch profiles for new pubkeys (IndexedDB + network in one request)
        // This is the key optimization: batch processing prevents individual fetches during scrolling
        // Use requestIdleCallback if available to avoid blocking scroll
        const scheduleFetch = (callback: () => void) => {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(callback, { timeout: 500 })
          } else {
            setTimeout(callback, 0)
          }
        }
        
        scheduleFetch(() => {
          client.fetchProfilesForPubkeys(newPubkeys).catch(() => {
            // On error, remove from prefetched set so we can retry later
            newPubkeys.forEach((p) => prefetchedPubkeysRef.current.delete(p))
          })
        })
      }, 300) // Debounce by 300ms to reduce frequency during rapid scrolling
      
      return () => {
        if (prefetchTimeoutRef.current) {
          clearTimeout(prefetchTimeoutRef.current)
          prefetchTimeoutRef.current = null
        }
      }
    }, [filteredEvents, events, extractEmbeddedEventIds])
    
    // CRITICAL: Prefetch embedded events for visible events
    useEffect(() => {
      // Throttle embedded event prefetching to reduce frequency during rapid scrolling
      // Clear any existing timeout
      if (prefetchEmbeddedEventsTimeoutRef.current) {
        clearTimeout(prefetchEmbeddedEventsTimeoutRef.current)
      }
      
      // Debounce embedded event prefetching by 400ms to reduce frequency during rapid scrolling
      prefetchEmbeddedEventsTimeoutRef.current = setTimeout(() => {
        // Extract embedded event IDs from visible events (first 40, reduced to reduce load)
        const visibleEmbeddedEventIds = new Set<string>()
        filteredEvents.slice(0, 40).forEach((ev) => {
          const embeddedIds = extractEmbeddedEventIds(ev)
          embeddedIds.forEach((id) => visibleEmbeddedEventIds.add(id))
        })
        
        // Also extract from upcoming events (next 80, reduced to reduce load)
        const upcomingEmbeddedEventIds = new Set<string>()
        events.slice(0, 80).forEach((ev) => {
          const embeddedIds = extractEmbeddedEventIds(ev)
          embeddedIds.forEach((id) => upcomingEmbeddedEventIds.add(id))
        })
        
        // Combine visible and upcoming
        const allEmbeddedEventIds = Array.from(
          new Set([...visibleEmbeddedEventIds, ...upcomingEmbeddedEventIds])
        )
        
        if (allEmbeddedEventIds.length === 0) return
        
        // Filter out already prefetched event IDs
        const eventIdsToFetch = allEmbeddedEventIds.filter(
          (id) => !prefetchedEventIdsRef.current.has(id)
        )
        
        if (eventIdsToFetch.length === 0) return
        
        // Mark as prefetched immediately to prevent duplicate requests
        eventIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.add(id))
        
        // Batch fetch embedded events in background (non-blocking)
        // Use requestIdleCallback if available to avoid blocking scroll
        const scheduleFetch = (callback: () => void) => {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(callback, { timeout: 500 })
          } else {
            setTimeout(callback, 0)
          }
        }
        
        scheduleFetch(() => {
          Promise.all(eventIdsToFetch.map((id) => client.fetchEvent(id))).catch(() => {
            // On error, remove from prefetched set so we can retry later
            eventIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.delete(id))
          })
        })
      }, 400) // Debounce by 400ms to reduce frequency during rapid scrolling
      
      return () => {
        if (prefetchEmbeddedEventsTimeoutRef.current) {
          clearTimeout(prefetchEmbeddedEventsTimeoutRef.current)
          prefetchEmbeddedEventsTimeoutRef.current = null
        }
      }
    }, [filteredEvents, events, extractEmbeddedEventIds])
    
    // Also prefetch when loading more events (scrolling down)
    // Throttled to reduce frequency during rapid scrolling
    const prefetchNewEventsTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    useEffect(() => {
      if (loading || !hasMore) return
      
      // Clear any existing timeout
      if (prefetchNewEventsTimeoutRef.current) {
        clearTimeout(prefetchNewEventsTimeoutRef.current)
      }
      
      // Debounce profile prefetching for newly loaded events (optimized to reduce stuttering)
      prefetchNewEventsTimeoutRef.current = setTimeout(() => {
        // When we have more events loaded, prefetch profiles for the newly loaded ones
        // Reduced to 50 to reduce batch size and prevent stuttering
        const newlyLoadedPubkeys = Array.from(
          new Set(events.slice(showCount, showCount + 50).map((ev) => ev.pubkey).filter((p) => p?.length === 64))
        )
        
        if (newlyLoadedPubkeys.length > 0) {
          // Filter out already prefetched pubkeys
          const newPubkeys = newlyLoadedPubkeys.filter((p) => !prefetchedPubkeysRef.current.has(p))
          
          if (newPubkeys.length > 0) {
            // Mark as prefetched immediately to prevent duplicate requests
            newPubkeys.forEach((p) => prefetchedPubkeysRef.current.add(p))
            
            // Batch fetch in background (non-blocking) using requestIdleCallback
            const scheduleFetch = (callback: () => void) => {
              if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(callback, { timeout: 500 })
              } else {
                setTimeout(callback, 0)
              }
            }
            
            scheduleFetch(() => {
              client.fetchProfilesForPubkeys(newPubkeys).catch(() => {
                // On error, remove from prefetched set so we can retry later
                newPubkeys.forEach((p) => prefetchedPubkeysRef.current.delete(p))
              })
            })
          }
        }
        
        // CRITICAL: Prefetch embedded events for newly loaded events (reduced scope)
        const newlyLoadedEmbeddedEventIds = new Set<string>()
        events.slice(showCount, showCount + 50).forEach((ev) => {
          const embeddedIds = extractEmbeddedEventIds(ev)
          embeddedIds.forEach((id) => newlyLoadedEmbeddedEventIds.add(id))
        })
        const eventIdsToFetch = Array.from(newlyLoadedEmbeddedEventIds).filter(
          (id) => !prefetchedEventIdsRef.current.has(id)
        )
        if (eventIdsToFetch.length > 0) {
          // Mark as prefetched immediately to prevent duplicate requests
          eventIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.add(id))
          // Batch fetch embedded events in background (non-blocking) using requestIdleCallback
          const scheduleFetch = (callback: () => void) => {
            if (typeof requestIdleCallback !== 'undefined') {
              requestIdleCallback(callback, { timeout: 500 })
            } else {
              setTimeout(callback, 0)
            }
          }
          
          scheduleFetch(() => {
            Promise.all(eventIdsToFetch.map((id) => client.fetchEvent(id))).catch(() => {
              // On error, remove from prefetched set so we can retry later
              eventIdsToFetch.forEach((id) => prefetchedEventIdsRef.current.delete(id))
            })
          })
        }
      }, 400) // Debounce by 400ms to reduce frequency during rapid scrolling
      
      return () => {
        if (prefetchNewEventsTimeoutRef.current) {
          clearTimeout(prefetchNewEventsTimeoutRef.current)
          prefetchNewEventsTimeoutRef.current = null
        }
      }
    }, [events.length, showCount, loading, hasMore])

    const showNewEvents = () => {
      setEvents((oldEvents) => [...newEvents, ...oldEvents])
      setNewEvents([])
      setTimeout(() => {
        scrollToTop('smooth')
      }, 0)
    }

    const list = (
      <div className="min-h-screen">
        {filteredEvents.map((event) => (
          <NoteCard
            key={event.id}
            className="w-full"
            event={event}
            filterMutedNotes={filterMutedNotes}
          />
        ))}
        {hasMore || loading ? (
          <div ref={bottomRef}>
            <NoteCardLoadingSkeleton />
          </div>
        ) : events.length ? (
          <div className="text-center text-sm text-muted-foreground mt-2">{t('no more notes')}</div>
        ) : (
          <div className="flex justify-center w-full mt-2">
            <Button size="lg" onClick={() => setRefreshCount((count) => count + 1)}>
              {t('reload notes')}
            </Button>
          </div>
        )}
      </div>
    )

    return (
      <div>
        <div ref={topRef} className="scroll-mt-[calc(6rem+1px)]" />
        {supportTouch ? (
          <PullToRefresh
            onRefresh={async () => {
              refresh()
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }}
            pullingContent=""
          >
            {list}
          </PullToRefresh>
        ) : (
          list
        )}
        <div className="h-40" />
        {filteredNewEvents.length > 0 && (
          <NewNotesButton newEvents={filteredNewEvents} onClick={showNewEvents} />
        )}
      </div>
    )
  }
)
NoteList.displayName = 'NoteList'
export default NoteList

export type TNoteListRef = {
  scrollToTop: (behavior?: ScrollBehavior) => void
  refresh: () => void
}
