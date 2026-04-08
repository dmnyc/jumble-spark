import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { ExtendedKind } from '@/constants'
import { getFavoritesFeedRelayUrls } from '@/lib/favorites-feed-relays'
import { fetchLatestReplaceableListEvent } from '@/lib/replaceable-list-latest'
import { buildPrioritizedReadRelayUrls } from '@/lib/relay-url-priority'
import client from '@/services/client.service'
import logger from '@/lib/logger'
import { GroupListContext } from './group-list-context'

export function GroupListProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: accountPubkey } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [userGroups, setUserGroups] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Build comprehensive relay list for fetching group list
  const buildComprehensiveRelayList = useCallback(async () => {
    const myRelayList = accountPubkey
      ? await client.fetchRelayList(accountPubkey)
      : {
          write: [],
          read: [],
          originalRelays: [],
          httpRead: [],
          httpWrite: [],
          httpOriginalRelays: []
        }
    const favoritesTier = getFavoritesFeedRelayUrls(favoriteRelays ?? [], blockedRelays)
    return buildPrioritizedReadRelayUrls({
      userReadRelays: [...(myRelayList.httpRead ?? []), ...(myRelayList.read ?? [])],
      userWriteRelays: [...(myRelayList.httpWrite ?? []), ...(myRelayList.write ?? [])],
      favoriteRelays: favoritesTier,
      blockedRelays,
      applySocialKindBlockedFilter: false
    })
  }, [accountPubkey, favoriteRelays, blockedRelays])

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
      
      const groupListEvent = await fetchLatestReplaceableListEvent(
        accountPubkey,
        ExtendedKind.GROUP_LIST,
        allRelays
      )

      if (groupListEvent) {
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
