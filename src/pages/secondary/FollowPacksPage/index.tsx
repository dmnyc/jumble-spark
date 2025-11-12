import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useFollowList } from '@/providers/FollowListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { getPubkeysFromPTags } from '@/lib/tag'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useState, forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import client from '@/services/client.service'
import { FAST_READ_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { Users } from 'lucide-react'
import logger from '@/lib/logger'
import ProfileSearchBar from '@/components/ui/ProfileSearchBar'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'

const FollowPacksPage = forwardRef<HTMLDivElement, { index?: number; hideTitlebar?: boolean }>(
  ({ index, hideTitlebar = false }, ref) => {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { followings, follow } = useFollowList()
  const [packs, setPacks] = useState<Event[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [_followingPacks, setFollowingPacks] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const fetchPacks = async () => {
      if (!pubkey) return
      
      setIsLoading(true)
      try {
        const relayUrls = FAST_READ_RELAY_URLS.map(url => normalizeUrl(url) || url)
        
        // Fetch kind 39089 events (starter packs)
        const events = await client.fetchEvents(relayUrls, [{
          kinds: [39089],
          limit: 100
        }])
        
        // Sort by created_at descending
        events.sort((a, b) => b.created_at - a.created_at)
        
        setPacks(events)
        
        // Check which packs the user is already following all members of
        const followingSet = new Set(followings)
        const packsFollowingAll = new Set<string>()
        
        events.forEach(pack => {
          const packPubkeys = getPubkeysFromPTags(pack.tags)
          if (packPubkeys.length > 0 && packPubkeys.every(p => followingSet.has(p))) {
            packsFollowingAll.add(pack.id)
          }
        })
        
        setFollowingPacks(packsFollowingAll)
      } catch (error) {
        logger.error('Failed to fetch follow packs', { error })
        toast.error(t('Failed to load follow packs'))
      } finally {
        setIsLoading(false)
      }
    }
    
    fetchPacks()
  }, [pubkey, followings])

  const handleFollowPack = async (pack: Event) => {
    if (!pubkey) {
      toast.error(t('Please log in to follow'))
      return
    }
    
    const packPubkeys = getPubkeysFromPTags(pack.tags)
    const followingSet = new Set(followings)
    const toFollow = packPubkeys.filter(p => !followingSet.has(p))
    
    if (toFollow.length === 0) {
      toast.info(t('You are already following all members of this pack'))
      return
    }
    
    try {
      // Follow all pubkeys in the pack
      for (const pubkeyToFollow of toFollow) {
        await follow(pubkeyToFollow)
      }
      toast.success(t('Followed {{count}} users', { count: toFollow.length }))
      
      // Update followingPacks if all members are now followed
      if (packPubkeys.every(p => followingSet.has(p) || toFollow.includes(p))) {
        setFollowingPacks(prev => new Set([...prev, pack.id]))
      }
    } catch (error) {
      logger.error('Failed to follow pack', { error })
      toast.error(t('Failed to follow pack') + ': ' + (error as Error).message)
    }
  }

  const getPackTitle = (pack: Event): string => {
    const titleTag = pack.tags.find(tag => tag[0] === 'title' || tag[0] === 'name')
    return titleTag?.[1] || t('Follow Pack')
  }

  const getPackDescription = (pack: Event): string => {
    const descTag = pack.tags.find(tag => tag[0] === 'description' || tag[0] === 'd')
    return descTag?.[1] || ''
  }

  const filteredPacks = useMemo(() => {
    if (!searchQuery.trim()) {
      return packs
    }
    const query = searchQuery.toLowerCase().trim()
    return packs.filter(pack => {
      const titleTag = pack.tags.find(tag => tag[0] === 'title' || tag[0] === 'name')
      const title = (titleTag?.[1] || t('Follow Pack')).toLowerCase()
      const descTag = pack.tags.find(tag => tag[0] === 'description' || tag[0] === 'd')
      const description = (descTag?.[1] || '').toLowerCase()
      return title.includes(query) || description.includes(query)
    })
  }, [packs, searchQuery, t])

  if (!pubkey) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title={t('Browse Follow Packs')} hideBackButton={hideTitlebar}>
        <div className="flex flex-col items-center justify-center py-16">
          <div className="text-lg font-semibold mb-2">{t('Please log in')}</div>
          <div className="text-sm text-muted-foreground">{t('You need to be logged in to browse follow packs')}</div>
        </div>
      </SecondaryPageLayout>
    )
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Browse Follow Packs')} hideBackButton={hideTitlebar} displayScrollToTopButton>
      <div className="space-y-4 p-4">
        {!isLoading && packs.length > 0 && (
          <div className="flex items-center gap-2">
            <ProfileSearchBar
              onSearch={setSearchQuery}
              placeholder={t('Search follow packs by name...')}
              className="w-full max-w-md"
            />
          </div>
        )}
        
        {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-full mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : packs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="text-lg font-semibold mb-2">{t('No follow packs found')}</div>
          <div className="text-sm text-muted-foreground">{t('There are no follow packs available at the moment')}</div>
        </div>
      ) : filteredPacks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="text-lg font-semibold mb-2">{t('No packs match your search')}</div>
          <div className="text-sm text-muted-foreground">{t('Try a different search term')}</div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredPacks.map((pack) => {
            const packPubkeys = getPubkeysFromPTags(pack.tags)
            const followingSet = new Set(followings)
            const alreadyFollowingAll = packPubkeys.length > 0 && packPubkeys.every(p => followingSet.has(p))
            const toFollowCount = packPubkeys.filter(p => !followingSet.has(p)).length
            
            return (
              <Card key={pack.id}>
                <CardHeader>
                  <CardTitle className="text-lg">{getPackTitle(pack)}</CardTitle>
                  {getPackDescription(pack) && (
                    <CardDescription className="line-clamp-2">{getPackDescription(pack)}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="size-4" />
                    <span>{t('{{count}} profiles', { count: packPubkeys.length })}</span>
                  </div>
                  
                  {packPubkeys.length > 0 && (
                    <div className="flex -space-x-2">
                      {packPubkeys.slice(0, 5).map((pubkey) => (
                        <SimpleUserAvatar 
                          key={pubkey} 
                          userId={pubkey} 
                          size="small" 
                          className="border-2 border-background"
                        />
                      ))}
                      {packPubkeys.length > 5 && (
                        <div className="size-8 rounded-full border-2 border-background bg-muted flex items-center justify-center text-xs">
                          +{packPubkeys.length - 5}
                        </div>
                      )}
                    </div>
                  )}
                  
                  <Button
                    className="w-full"
                    onClick={() => handleFollowPack(pack)}
                    disabled={alreadyFollowingAll}
                    variant={alreadyFollowingAll ? 'secondary' : 'default'}
                  >
                    {alreadyFollowingAll ? (
                      t('Following All')
                    ) : (
                      <>
                        {t('Follow')} {toFollowCount > 0 && `(${toFollowCount})`}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
        )}
      </div>
    </SecondaryPageLayout>
  )
})

FollowPacksPage.displayName = 'FollowPacksPage'
export default FollowPacksPage

