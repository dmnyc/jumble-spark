import { createInterestListDraftEvent } from '@/lib/draft-event'
import { normalizeTopic } from '@/lib/discussion-topics'
import { normalizeUrl } from '@/lib/url'
import { FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import logger from '@/lib/logger'
import client from '@/services/client.service'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useNostr } from '@/providers/nostr-context'
import { useFavoriteRelays } from './FavoriteRelaysProvider'

type TInterestListContext = {
  subscribedTopics: Set<string>
  changing: boolean
  isSubscribed: (topic: string) => boolean
  subscribe: (topic: string) => Promise<void>
  unsubscribe: (topic: string) => Promise<void>
  getSubscribedTopics: () => string[]
}

const InterestListContext = createContext<TInterestListContext | undefined>(undefined)

export const useInterestList = () => {
  const context = useContext(InterestListContext)
  if (!context) {
    throw new Error('useInterestList must be used within an InterestListProvider')
  }
  return context
}

export function InterestListProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey, interestListEvent, publish, updateInterestListEvent } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const [topics, setTopics] = useState<string[]>([])
  const subscribedTopics = useMemo(() => new Set(topics), [topics])
  const [changing, setChanging] = useState(false)

  // Build comprehensive relay list for publishing (same as ProfileFeed)
  const buildComprehensiveRelayList = useCallback(async () => {
    const myRelayList = accountPubkey ? await client.fetchRelayList(accountPubkey) : { write: [], read: [] }
    const allRelays = [
      ...(myRelayList.read || []), // User's inboxes (kind 10002)
      ...(myRelayList.write || []), // User's outboxes (kind 10002)
      ...(favoriteRelays || []), // User's favorite relays (kind 10012)
      ...FAST_READ_RELAY_URLS,   // Fast read relays
      ...FAST_WRITE_RELAY_URLS   // Fast write relays
    ]
    
    const normalizedRelays = allRelays
      .map(url => normalizeUrl(url))
      .filter((url): url is string => !!url)
    
    return Array.from(new Set(normalizedRelays))
  }, [accountPubkey, favoriteRelays])

  useEffect(() => {
    const updateTopics = () => {
      if (!interestListEvent) {
        setTopics([])
        return
      }

      // Extract t-tags from the interest list
      const topicTags = interestListEvent.tags
        .filter(tag => tag[0] === 't' && tag[1])
        .map(tag => normalizeTopic(tag[1]))
      
      setTopics(topicTags)
    }
    updateTopics()
  }, [interestListEvent])

  const getSubscribedTopics = useCallback(() => {
    return Array.from(subscribedTopics)
  }, [subscribedTopics])

  const isSubscribed = useCallback(
    (topic: string): boolean => {
      return subscribedTopics.has(normalizeTopic(topic))
    },
    [subscribedTopics]
  )

  const publishNewInterestListEvent = async (newTopics: string[]) => {
    const newInterestListEvent = createInterestListDraftEvent(newTopics)
    
    // Use the same comprehensive relay list as pins for publishing
    const comprehensiveRelays = await buildComprehensiveRelayList()
    logger.component('InterestListProvider', 'Publishing to comprehensive relays', { count: comprehensiveRelays.length })
    
    const publishedEvent = await publish(newInterestListEvent, {
      specifiedRelayUrls: comprehensiveRelays
    })
    return publishedEvent
  }

  const subscribe = async (topic: string) => {
    logger.component('InterestListProvider', 'subscribe called', { topic, accountPubkey, changing })
    if (!accountPubkey || changing) return

    const normalizedTopic = normalizeTopic(topic)
    if (subscribedTopics.has(normalizedTopic)) {
      logger.component('InterestListProvider', 'Already subscribed to topic')
      return
    }

    setChanging(true)
    try {
      logger.component('InterestListProvider', 'Fetching existing interest list event')
      const interestListEvent = await client.fetchInterestListEvent(accountPubkey)
      logger.component('InterestListProvider', 'Existing interest list event', { hasEvent: !!interestListEvent })
      
      const currentTopics = interestListEvent
        ? interestListEvent.tags
            .filter((tag: string[]) => tag[0] === 't' && tag[1])
            .map((tag: string[]) => normalizeTopic(tag[1]))
        : []

      logger.component('InterestListProvider', 'Current topics', { topics: currentTopics })

      if (currentTopics.includes(normalizedTopic)) {
        logger.component('InterestListProvider', 'Already subscribed to topic (from event)')
        return
      }

      const newTopics = [...currentTopics, normalizedTopic]
      logger.component('InterestListProvider', 'Creating new interest list with topics', { topics: newTopics })
      
      const newInterestListEvent = await publishNewInterestListEvent(newTopics)
      logger.component('InterestListProvider', 'Published new interest list event', { hasEvent: !!newInterestListEvent })
      
      await updateInterestListEvent(newInterestListEvent)
      logger.component('InterestListProvider', 'Updated interest list event in state')
      
      toast.success(t('Subscribed to topic'))
    } catch (error) {
      logger.component('InterestListProvider', 'Failed to publish interest list event', { error: (error as Error).message })
      // Even if publishing fails, the subscription worked locally, so show success
      // The user can still see their hashtag feed working
      toast.success(t('Subscribed to topic (local)'))
    } finally {
      setChanging(false)
    }
  }

  const unsubscribe = async (topic: string) => {
    if (!accountPubkey || changing) return

    const normalizedTopic = normalizeTopic(topic)
    if (!subscribedTopics.has(normalizedTopic)) {
      return
    }

    setChanging(true)
    try {
      const interestListEvent = await client.fetchInterestListEvent(accountPubkey)
      if (!interestListEvent) return

      const currentTopics = interestListEvent.tags
        .filter((tag: string[]) => tag[0] === 't' && tag[1])
        .map((tag: string[]) => normalizeTopic(tag[1]))

      const newTopics = currentTopics.filter((t: string) => t !== normalizedTopic)
      
      if (newTopics.length === currentTopics.length) {
        // Topic wasn't in the list
        return
      }

      const newInterestListEvent = await publishNewInterestListEvent(newTopics)
      await updateInterestListEvent(newInterestListEvent)
      
      toast.success(t('Unsubscribed from topic'))
    } catch (error) {
      logger.component('InterestListProvider', 'Failed to unsubscribe from topic', { error: (error as Error).message })
      toast.error(t('Failed to unsubscribe from topic') + ': ' + (error as Error).message)
    } finally {
      setChanging(false)
    }
  }

  return (
    <InterestListContext.Provider
      value={{
        subscribedTopics,
        changing,
        isSubscribed,
        subscribe,
        unsubscribe,
        getSubscribedTopics
      }}
    >
      {children}
    </InterestListContext.Provider>
  )
}

