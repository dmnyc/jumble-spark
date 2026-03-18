import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import { compareEvents } from '@/lib/event'
import logger from '@/lib/logger'
import { notificationFilter } from '@/lib/notification'
import { usePrimaryPage } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import { kinds, NostrEvent } from 'nostr-tools'
import { SubCloser } from 'nostr-tools/abstract-pool'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useContentPolicy } from './ContentPolicyProvider'
import { useMuteList } from './MuteListProvider'
import { useNostr } from './NostrProvider'
import { useUserTrust } from './UserTrustProvider'
import { NotificationContext } from './NotificationContext'

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { current } = usePrimaryPage()
  const active = useMemo(() => current === 'notifications', [current])
  const { pubkey, relayList, notificationsSeenAt, updateNotificationsSeenAt } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const { hideUntrustedNotifications, isUserTrusted } = useUserTrust()
  const { mutePubkeySet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  // const { getSubscribedTopics } = useInterestList() // No longer needed since we subscribe to all discussions
  const [newNotifications, setNewNotifications] = useState<NostrEvent[]>([])
  const [readNotificationIdSet, setReadNotificationIdSet] = useState<Set<string>>(new Set())
  const filteredNewNotifications = useMemo(() => {
    if (active || notificationsSeenAt < 0) {
      return []
    }
    const filtered: NostrEvent[] = []
    for (const notification of newNotifications) {
      if (notification.created_at <= notificationsSeenAt || filtered.length >= 10) {
        break
      }
      if (
        !notificationFilter(notification, {
          pubkey,
          mutePubkeySet,
          hideContentMentioningMutedUsers,
          hideUntrustedNotifications,
          isUserTrusted
        })
      ) {
        continue
      }
      filtered.push(notification)
    }
    return filtered
  }, [
    newNotifications,
    notificationsSeenAt,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    hideUntrustedNotifications,
    isUserTrusted,
    active
  ])

  // Defer so we don't trigger state updates during the same commit as consumer renders (avoids "Cannot update NotificationList while rendering NotificationProvider")
  useEffect(() => {
    let t2: ReturnType<typeof setTimeout> | null = null
    const t = setTimeout(() => {
      setNewNotifications([])
      t2 = setTimeout(() => {
        updateNotificationsSeenAt(!active)
      }, 0)
    }, 0)
    return () => {
      clearTimeout(t)
      if (t2 !== null) clearTimeout(t2)
    }
  }, [active, updateNotificationsSeenAt])

  useEffect(() => {
    if (!pubkey) return

    const deferredReset = setTimeout(() => {
      setNewNotifications([])
      setReadNotificationIdSet(new Set())
    }, 0)

    // Track if component is mounted
    const isMountedRef = { current: true }
    const subCloserRef: {
      current: SubCloser | null
    } = { current: null }
    const topicSubCloserRef: {
      current: SubCloser | null
    } = { current: null }

    const subscribe = async () => {
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
        // Use proper fallback hierarchy: user's read/inbox relays → favorite relays → fast read relays
        const userRelayList = relayList || { read: [], write: [] }
        const userReadRelays = userRelayList.read || []
        const userFavoriteRelays = favoriteRelays || []
        
        // Build relay list with proper fallback hierarchy
        let notificationRelays: string[] = []
        
        if (userReadRelays.length > 0) {
          // Priority 1: User's read/inbox relays (kind 10002)
          notificationRelays = userReadRelays.slice(0, 5)
          logger.component('NotificationProvider', 'Using user read relays', { 
            count: notificationRelays.length, 
            relays: notificationRelays.slice(0, 3) // Show first 3 for brevity
          })
        } else if (userFavoriteRelays.length > 0) {
          // Priority 2: User's favorite relays (kind 10012)
          notificationRelays = userFavoriteRelays.slice(0, 5)
          logger.component('NotificationProvider', 'Using user favorite relays', { 
            count: notificationRelays.length, 
            relays: notificationRelays.slice(0, 3) // Show first 3 for brevity
          })
        } else {
          // Priority 3: Fast read relays (reliable defaults)
          notificationRelays = FAST_READ_RELAY_URLS.slice(0, 5)
          logger.component('NotificationProvider', 'Using fast read relays fallback', { 
            count: notificationRelays.length, 
            relays: notificationRelays.slice(0, 3) // Show first 3 for brevity
          })
        }
        
        // Subscribe to discussion notifications (kind 11)
        // Subscribe to all discussions, not just subscribed topics
        let discussionEosed = false
        const discussionSubCloser = client.subscribe(
          notificationRelays,
          [
            {
              kinds: [11], // Discussion threads
              limit: 20
            }
          ],
          {
            oneose: (e) => {
              if (e) {
                discussionEosed = e
              }
            },
            onevent: (evt) => {
              // Don't notify about our own threads
              if (evt.pubkey !== pubkey) {
                setNewNotifications((prev) => {
                  if (!discussionEosed) {
                    return [evt, ...prev]
                  }
                  if (prev.length && compareEvents(prev[0], evt) >= 0) {
                    return prev
                  }

                  client.emitNewEvent(evt)
                  return [evt, ...prev]
                })
              }
            }
          }
        )
        topicSubCloserRef.current = discussionSubCloser
        
        // Regular notifications subscription
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
                setNewNotifications((prev) => {
                  return [...prev.sort((a, b) => compareEvents(b, a))]
                })
              }
            },
            onevent: (evt) => {
              if (evt.pubkey !== pubkey) {
                setNewNotifications((prev) => {
                  if (!eosed) {
                    return [evt, ...prev]
                  }
                  if (prev.length && compareEvents(prev[0], evt) >= 0) {
                    return prev
                  }

                  client.emitNewEvent(evt)
                  return [evt, ...prev]
                })
              }
            },
            onAllClose: (reasons) => {
              if (reasons.every((reason) => reason === 'closed by caller')) {
                return
              }

              // Only reconnect if still mounted and not a manual close
              // Increase timeout to prevent rapid reconnection loops
              if (isMountedRef.current) {
                setTimeout(() => {
                  if (isMountedRef.current) {
                    logger.debug('[NotificationProvider] Reconnecting after close...')
                    subscribe()
                  }
                }, 15_000) // Increased from 5s to 15s
              }
            }
          }
        )

        subCloserRef.current = subCloser
        return subCloser
      } catch (error) {
        logger.error('Subscription error', { error })

        // Retry on error if still mounted
        if (isMountedRef.current) {
          setTimeout(() => {
            if (isMountedRef.current) {
              subscribe()
            }
          }, 5_000)
        }
        return null
      }
    }

    // Initial subscription
    subscribe()

    // Cleanup function
    return () => {
      clearTimeout(deferredReset)
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
  }, [pubkey])

  useEffect(() => {
    const newNotificationCount = filteredNewNotifications.length

    // Update title
    if (newNotificationCount > 0) {
      document.title = `(${newNotificationCount >= 10 ? '9+' : newNotificationCount}) Jumble`
    } else {
      document.title = 'Jumble'
    }

    // Update favicons
    const favicons = document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']")
    if (!favicons.length) return

    const treeFavicon = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌲</text></svg>"

    if (newNotificationCount === 0) {
      favicons.forEach((favicon) => {
        favicon.href = treeFavicon
      })
    } else {
      // Create a canvas with the tree emoji and a notification badge
      const canvas = document.createElement('canvas')
      const size = 64
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) // Optimize for frequent readback operations
      if (!ctx) return
      
      // Draw tree emoji as text
      ctx.font = `${size * 0.9}px Arial`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      ctx.fillText('🌲', size / 2, size / 2)
      
      // Draw red notification badge
      const r = size * 0.16
      ctx.beginPath()
      ctx.arc(size - r - 6, r + 6, r, 0, 2 * Math.PI)
      ctx.fillStyle = '#FF0000'
      ctx.fill()
      
      favicons.forEach((favicon) => {
        favicon.href = canvas.toDataURL('image/png')
      })
    }
  }, [filteredNewNotifications])

  const getNotificationsSeenAt = useCallback(() => {
    if (notificationsSeenAt >= 0) {
      return notificationsSeenAt
    }
    if (pubkey) {
      return storage.getLastReadNotificationTime(pubkey)
    }
    return 0
  }, [notificationsSeenAt, pubkey])

  const isNotificationRead = useCallback(
    (notificationId: string): boolean => readNotificationIdSet.has(notificationId),
    [readNotificationIdSet]
  )

  const markNotificationAsRead = useCallback((notificationId: string) => {
    setReadNotificationIdSet((prev) => new Set([...prev, notificationId]))
  }, [])

  const value = useMemo(
    () => ({
      hasNewNotification: filteredNewNotifications.length > 0,
      getNotificationsSeenAt,
      isNotificationRead,
      markNotificationAsRead
    }),
    [
      filteredNewNotifications.length,
      getNotificationsSeenAt,
      isNotificationRead,
      markNotificationAsRead
    ]
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}
