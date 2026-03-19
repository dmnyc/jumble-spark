import { ExtendedKind, FAST_READ_RELAY_URLS } from '@/constants'
import { compareEvents } from '@/lib/event'
import logger from '@/lib/logger'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import client from '@/services/client.service'
import { kinds, NostrEvent } from 'nostr-tools'
import { SubCloser } from 'nostr-tools/abstract-pool'
import { useEffect, useRef } from 'react'
import { useNostr } from './NostrProvider'

/**
 * Subscribes to live notifications and forwards new events via {@link client.emitNewEvent}.
 * (Read/unread UI and cross-device “seen at” sync were removed.)
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, relayList } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const notificationBufferRef = useRef<NostrEvent[]>([])

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
        const userRelayList = relayList || { read: [], write: [] }
        const userReadRelays = userRelayList.read || []
        const userFavoriteRelays = favoriteRelays || []

        let notificationRelays: string[] = []

        if (userReadRelays.length > 0) {
          notificationRelays = userReadRelays.slice(0, 5)
          logger.component('NotificationProvider', 'Using user read relays', {
            count: notificationRelays.length,
            relays: notificationRelays.slice(0, 3)
          })
        } else if (userFavoriteRelays.length > 0) {
          notificationRelays = userFavoriteRelays.slice(0, 5)
          logger.component('NotificationProvider', 'Using user favorite relays', {
            count: notificationRelays.length,
            relays: notificationRelays.slice(0, 3)
          })
        } else {
          notificationRelays = FAST_READ_RELAY_URLS.slice(0, 5)
          logger.component('NotificationProvider', 'Using fast read relays fallback', {
            count: notificationRelays.length,
            relays: notificationRelays.slice(0, 3)
          })
        }

        let discussionEosed = false
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
              }
            },
            onevent: (evt) => {
              if (evt.pubkey !== pubkey) {
                const prev = notificationBufferRef.current
                if (!discussionEosed) {
                  notificationBufferRef.current = [evt, ...prev]
                  return
                }
                if (prev.length && compareEvents(prev[0], evt) >= 0) {
                  return
                }

                client.emitNewEvent(evt)
                notificationBufferRef.current = [evt, ...prev]
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
                notificationBufferRef.current = [
                  ...notificationBufferRef.current.sort((a, b) => compareEvents(b, a))
                ]
              }
            },
            onevent: (evt) => {
              if (evt.pubkey !== pubkey) {
                const prev = notificationBufferRef.current
                if (!eosed) {
                  notificationBufferRef.current = [evt, ...prev]
                  return
                }
                if (prev.length && compareEvents(prev[0], evt) >= 0) {
                  return
                }

                client.emitNewEvent(evt)
                notificationBufferRef.current = [evt, ...prev]
              }
            },
            onAllClose: (reasons) => {
              if (reasons.every((reason) => reason === 'closed by caller')) {
                return
              }

              if (isMountedRef.current) {
                setTimeout(() => {
                  if (isMountedRef.current) {
                    logger.debug('[NotificationProvider] Reconnecting after close...')
                    subscribe()
                  }
                }, 15_000)
              }
            }
          }
        )

        subCloserRef.current = subCloser
        return subCloser
      } catch (error) {
        logger.error('Subscription error', { error })

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

    subscribe()

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
  }, [pubkey, relayList, favoriteRelays])

  return <>{children}</>
}
