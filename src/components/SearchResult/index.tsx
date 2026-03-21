import { FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import { TSearchParams } from '@/types'
import NormalFeed from '../NormalFeed'
import Profile from '../Profile'
import { ProfileListBySearch } from '../ProfileListBySearch'
import Relay from '../Relay'
import TrendingNotes from '../TrendingNotes'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { normalizeUrl } from '@/lib/url'
import { useMemo } from 'react'

export default function SearchResult({ searchParams }: { searchParams: TSearchParams | null }) {
  const { pubkey, relayList } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  
  // Build comprehensive relay list for search (all available relays)
  const searchRelays = useMemo(() => {
    let relays: string[] = []
    
    // User's relays
    if (relayList) {
      relays.push(...(relayList.read || []), ...(relayList.write || []))
    }
    
    // User's favorite relays
    relays.push(...(favoriteRelays || []))
    
    // All default relays
    relays.push(...FAST_READ_RELAY_URLS, ...FAST_WRITE_RELAY_URLS, ...SEARCHABLE_RELAY_URLS)
    
    // Normalize and deduplicate
    const normalized = Array.from(new Set(
      relays.map(url => normalizeUrl(url) || url).filter((url): url is string => !!url)
    ))
    
    // Filter blocked
    return normalized.filter(relay => 
      !blockedRelays.some(blocked => relay.includes(blocked))
    )
  }, [pubkey, relayList, favoriteRelays, blockedRelays])
  
  if (!searchParams) {
    return <TrendingNotes variant="searchAccordion" />
  }
  if (searchParams.type === 'profile') {
    return <Profile id={searchParams.search} />
  }
  if (searchParams.type === 'profiles') {
    return <ProfileListBySearch search={searchParams.search} />
  }
  if (searchParams.type === 'notes') {
    return (
      <NormalFeed
        subRequests={[{ urls: searchRelays, filter: { search: searchParams.search } }]}
      />
    )
  }
  if (searchParams.type === 'hashtag') {
    return (
      <NormalFeed
        subRequests={[{ urls: searchRelays, filter: { '#t': [searchParams.search] } }]}
      />
    )
  }
  return <Relay url={searchParams.search} />
}
