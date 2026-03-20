import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { ExtendedKind } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { BIG_RELAY_URLS, FAST_READ_RELAY_URLS } from '@/constants'
import client from '@/services/client.service'
import { queryService } from '@/services/client.service'
import logger from '@/lib/logger'

interface GroupListContextType {
  userGroups: string[]
  isUserInGroup: (groupId: string) => boolean
  refreshGroupList: () => Promise<void>
  isLoading: boolean
}

const GroupListContext = createContext<GroupListContextType | undefined>(undefined)

export const useGroupList = () => {
  const context = useContext(GroupListContext)
  if (context === undefined) {
    throw new Error('useGroupList must be used within a GroupListProvider')
  }
  return context
}

export function GroupListProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: accountPubkey } = useNostr()
  const { favoriteRelays } = useFavoriteRelays()
  const [userGroups, setUserGroups] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Build comprehensive relay list for fetching group list
  const buildComprehensiveRelayList = useCallback(async () => {
    const myRelayList = accountPubkey ? await client.fetchRelayList(accountPubkey) : { write: [], read: [] }
    const allRelays = [
      ...(myRelayList.read || []), // User's inboxes (kind 10002)
      ...(myRelayList.write || []), // User's outboxes (kind 10002)
      ...(favoriteRelays || []), // User's favorite relays (kind 10012)
      ...BIG_RELAY_URLS,         // Big relays
      ...FAST_READ_RELAY_URLS    // Fast read relays
    ]
    
    const normalizedRelays = allRelays
      .map(url => normalizeUrl(url))
      .filter((url): url is string => !!url)
    
    return Array.from(new Set(normalizedRelays))
  }, [accountPubkey, favoriteRelays])

  // Fetch user's group list (kind 10009)
  const fetchGroupList = useCallback(async () => {
    if (!accountPubkey) {
      setUserGroups([])
      return
    }

    try {
      setIsLoading(true)
      logger.debug('[GroupListProvider] Fetching group list for user:', accountPubkey.substring(0, 8))
      
      // Get comprehensive relay list
      const allRelays = await buildComprehensiveRelayList()
      
      // Fetch group list event (kind 10009)
      const groupListEvents = await queryService.fetchEvents(allRelays, [
        {
          kinds: [ExtendedKind.GROUP_LIST],
          authors: [accountPubkey],
          limit: 1
        }
      ])
      
      if (groupListEvents.length > 0) {
        const groupListEvent = groupListEvents[0]
        logger.debug('[GroupListProvider] Found group list event:', groupListEvent.id.substring(0, 8))
        
        // Extract groups from a-tags (group coordinates)
        const groups: string[] = []
        groupListEvent.tags.forEach(tag => {
          if (tag[0] === 'a' && tag[1]) {
            // Parse group coordinate: kind:pubkey:group-id
            const coordinate = tag[1]
            const parts = coordinate.split(':')
            if (parts.length >= 3) {
              const groupId = parts[2]
              groups.push(groupId)
            }
          }
        })
        
        setUserGroups(groups)
        logger.debug('[GroupListProvider] Extracted groups:', groups)
      } else {
        setUserGroups([])
        logger.debug('[GroupListProvider] No group list found')
      }
    } catch (error) {
      logger.error('[GroupListProvider] Error fetching group list:', error)
      setUserGroups([])
    } finally {
      setIsLoading(false)
    }
  }, [accountPubkey, buildComprehensiveRelayList])

  // Check if user is in a specific group
  const isUserInGroup = useCallback((groupId: string): boolean => {
    return userGroups.includes(groupId)
  }, [userGroups])

  // Refresh group list
  const refreshGroupList = useCallback(async () => {
    await fetchGroupList()
  }, [fetchGroupList])

  // Load group list on mount and when account changes
  useEffect(() => {
    fetchGroupList()
  }, [fetchGroupList])

  const contextValue = useMemo(() => ({
    userGroups,
    isUserInGroup,
    refreshGroupList,
    isLoading
  }), [userGroups, isUserInGroup, refreshGroupList, isLoading])

  return (
    <GroupListContext.Provider value={contextValue}>
      {children}
    </GroupListContext.Provider>
  )
}
