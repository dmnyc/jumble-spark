import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import { compareEvents } from '@/lib/event'
import logger from '@/lib/logger'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import { kinds, NostrEvent } from 'nostr-tools'
import { SubCloser } from 'nostr-tools/abstract-pool'
import { useEffect, useRef, useMemo } from 'react'
import { useNostr } from './NostrProvider'

/**
 * Subscribes to live notifications and forwards new events via {@link client.emitNewEvent}.
 * (Read/unread UI and cross-device “seen at” sync were removed.)
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, relayList } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const notificationBufferRef = useRef<NostrEvent[]>([])
  const retryCountRef = useRef(0)
  const retryTimeoutIdRef = useRef<NodeJS.Timeout | null>(null)

  // Memoize relay URLs to prevent unnecessary re-subscriptions
  // This creates stable references based on actual relay URLs, not object references
  const userReadRelays = useMemo(() => {
    const userRelayList = relayList || { read: [], write: [] }
    return userRelayList.read || []
  }, [relayList?.read?.join(',')]) // Compare by stringified array, not object reference

  const userFavoriteRelays = useMemo(() => {
    return favoriteRelays || []
  }, [favoriteRelays?.join(',')]) // Compare by stringified array, not array reference

  // Memoize the notification relays to prevent re-subscriptions when they haven't changed
  const notificationRelays = useMemo(() => {
    if (userReadRelays.length > 0) {
      return userReadRelays.slice(0, 5)
    } else if (userFavoriteRelays.length > 0) {
      return userFavoriteRelays.slice(0, 5)
    } else {
      return FAST_READ_RELAY_URLS.slice(0, 5)
    }
  }, [userReadRelays, userFavoriteRelays])

  useEffect(() => {
    if (!pubkey) return

    const deferredReset = setTimeout(() => {
      notificationBufferRef.current = []
    }, 0)

    const isMountedRef = { current: true }
    const subCloserRef: {
      current: SubCloser | null
    } = { current: null }
    const topicSubCloserRef: {
      current: SubCloser | null
    } = { current: null }
    const MAX_RETRIES = 5
    // Reset retry count when effect runs (relays changed)
    retryCountRef.current = 0

    const subscribe = async () => {
      // Clear any pending retries
      if (retryTimeoutIdRef.current) {
        clearTimeout(retryTimeoutIdRef.current)
        retryTimeoutIdRef.current = null
      }

      if (subCloserRef.current) {
        subCloserRef.current.close()
        subCloserRef.current = null
      }
      if (topicSubCloserRef.current) {
        topicSubCloserRef.current.close()
        topicSubCloserRef.current = null
      }
      if (!isMountedRef.current) return null

      try {
        let eosed = false
        // Reset retry count on successful subscription attempt
        retryCountRef.current = 0

        if (notificationRelays.length > 0) {
          logger.component('NotificationProvider', 'Using notification relays', {
            count: notificationRelays.length,
            relays: notificationRelays.slice(0, 3)
          })
        }

        let discussionEosed = false
        let initialBufferFlushed = false
        const flushBufferedIfReady = () => {
          if (
            !eosed ||
            !discussionEosed ||
            !isMountedRef.current ||
            initialBufferFlushed
          ) {
            return
          }
          initialBufferFlushed = true
          const buf = notificationBufferRef.current
          if (buf.length === 0) return
          const sorted = [...buf].sort((a, b) => compareEvents(b, a))
          notificationBufferRef.current = sorted.slice(0, 50)
          for (const evt of sorted) {
            client.emitNewEvent(evt)
          }
        }

        const discussionSubCloser = client.subscribe(
          notificationRelays,
          [
            {
              kinds: [11],
              limit: 20
            }
          ],
          {
            oneose: (e) => {
              if (e) {
                discussionEosed = e
                flushBufferedIfReady()
              }
            },
            onevent: (evt) => {
              if (evt.pubkey !== pubkey) {
                const prev = notificationBufferRef.current
                if (!discussionEosed) {
                  // Before EOSE: just buffer events, limit size
                  if (prev.length < 100) {
                    notificationBufferRef.current = [evt, ...prev]
                  }
                  return
                }
                if (prev.length && compareEvents(prev[0], evt) >= 0) {
                  return
                }

                // Limit buffer size to prevent memory issues
                if (prev.length >= 50) {
                  notificationBufferRef.current = [evt, ...prev.slice(0, 49)]
                } else {
                  notificationBufferRef.current = [evt, ...prev]
                }
                client.emitNewEvent(evt)
              }
            }
          }
        )
        topicSubCloserRef.current = discussionSubCloser

        const subCloser = client.subscribe(
          notificationRelays,
          [
            {
              kinds: [
                kinds.ShortTextNote,
                kinds.Repost,
                kinds.Reaction,
                kinds.Zap,
                ExtendedKind.COMMENT,
                ExtendedKind.POLL_RESPONSE,
                ExtendedKind.VOICE_COMMENT,
                ExtendedKind.POLL,
                ExtendedKind.PUBLIC_MESSAGE
              ],
              '#p': [pubkey],
              limit: 20
            }
          ],
          {
            oneose: (e) => {
              if (e) {
                eosed = e
                // Don't sort on every EOSE - sorting is expensive and buffer is already maintained in order
                // Only sort if buffer is getting large and out of order
                if (notificationBufferRef.current.length > 100) {
                  notificationBufferRef.current = [
                    ...notificationBufferRef.current.sort((a, b) => compareEvents(b, a))
                  ]
                }
                flushBufferedIfReady()
              }
            },
            onevent: (evt) => {
              if (evt.pubkey !== pubkey) {
                const prev = notificationBufferRef.current
                if (!eosed) {
                  // Before EOSE: just buffer events, don't emit yet
                  // Limit buffer size to prevent memory issues
                  if (prev.length < 100) {
                    notificationBufferRef.current = [evt, ...prev]
                  }
                  return
                }
                // After EOSE: only emit if it's newer than the most recent event
                if (prev.length && compareEvents(prev[0], evt) >= 0) {
                  return
                }

                // Limit buffer size to prevent memory issues
                if (prev.length >= 50) {
                  notificationBufferRef.current = [evt, ...prev.slice(0, 49)]
                } else {
                  notificationBufferRef.current = [evt, ...prev]
                }
                client.emitNewEvent(evt)
              }
            },
            onAllClose: (reasons) => {
              if (reasons.every((reason) => reason === 'closed by caller')) {
                return
              }

              if (isMountedRef.current && retryCountRef.current < MAX_RETRIES) {
                retryCountRef.current++
                const delay = Math.min(15_000 * retryCountRef.current, 60_000) // Exponential backoff, max 60s
                logger.debug(`[NotificationProvider] Reconnecting after close (attempt ${retryCountRef.current}/${MAX_RETRIES})...`)
                retryTimeoutIdRef.current = setTimeout(() => {
                  if (isMountedRef.current) {
                    subscribe()
                  }
                }, delay)
              } else if (retryCountRef.current >= MAX_RETRIES) {
                logger.error('[NotificationProvider] Max retries reached, stopping reconnection attempts')
              }
            }
          }
        )

        subCloserRef.current = subCloser
        return subCloser
      } catch (error) {
        logger.error('Subscription error', { error, retryCount: retryCountRef.current })

        if (isMountedRef.current && retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++
          const delay = Math.min(5_000 * retryCountRef.current, 30_000) // Exponential backoff, max 30s
          retryTimeoutIdRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              subscribe()
            }
          }, delay)
        } else if (retryCountRef.current >= MAX_RETRIES) {
          logger.error('[NotificationProvider] Max retries reached, stopping subscription attempts')
        }
        return null
      }
    }

    subscribe()

    return () => {
      clearTimeout(deferredReset)
      if (retryTimeoutIdRef.current) {
        clearTimeout(retryTimeoutIdRef.current)
        retryTimeoutIdRef.current = null
      }
      retryCountRef.current = 0 // Reset retry count on cleanup
      isMountedRef.current = false
      if (subCloserRef.current) {
        subCloserRef.current.close()
        subCloserRef.current = null
      }
      if (topicSubCloserRef.current) {
        topicSubCloserRef.current.close()
        topicSubCloserRef.current = null
      }
    }
  }, [pubkey, notificationRelays.join(',')]) // Use memoized notificationRelays instead of relayList/favoriteRelays

  return <>{children}</>
}
