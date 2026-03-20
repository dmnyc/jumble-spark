import { Favicon } from '@/components/Favicon'
import NormalFeed from '@/components/NormalFeed'
import { Button } from '@/components/ui/button'
import { FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { toProfileList } from '@/lib/link'
import { fetchPubkeysFromDomain, getWellKnownNip05Url } from '@/lib/nip05'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { useInterestList } from '@/providers/InterestListProvider'
import client from '@/services/client.service'
import { TFeedSubRequest } from '@/types'
import { UserRound, Plus } from 'lucide-react'
import React, { forwardRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

interface NoteListPageProps {
  index?: number
  hideTitlebar?: boolean
}

const NoteListPage = forwardRef<HTMLDivElement, NoteListPageProps>(({ index, hideTitlebar = false }, ref) => {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { relayList, pubkey } = useNostr()
  const { isSubscribed, subscribe } = useInterestList()
  const [title, setTitle] = useState<React.ReactNode>(null)
  const [controls, setControls] = useState<React.ReactNode>(null)
  const [data, setData] = useState<
    | {
        type: 'hashtag' | 'search' | 'externalContent' | 'dtag'
        kinds?: number[]
        dtag?: string
      }
    | {
        type: 'domain'
        domain: string
        kinds?: number[]
      }
    | null
  >(null)
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])

  // Get hashtag from URL if this is a hashtag page
  const hashtag = useMemo(() => {
    if (data?.type === 'hashtag') {
      const searchParams = new URLSearchParams(window.location.search)
      return searchParams.get('t')
    }
    return null
  }, [data])

  // Check if the hashtag is already in the user's interest list
  const isHashtagSubscribed = useMemo(() => {
    if (!hashtag) return false
    return isSubscribed(hashtag)
  }, [hashtag, isSubscribed])

  // Add hashtag to interest list - wrapped in useCallback to prevent circular dependencies
  const handleSubscribeHashtag = useCallback(async () => {
    const searchParams = new URLSearchParams(window.location.search)
    const hashtag = searchParams.get('t')
    if (!hashtag) return
    await subscribe(hashtag)
  }, [subscribe])

  // Extract initialization logic into a reusable function
  const initializeFromUrl = useCallback(async () => {
    const searchParams = new URLSearchParams(window.location.search)
    const kinds = searchParams
      .getAll('k')
      .map((k) => parseInt(k))
      .filter((k) => !isNaN(k))
    const hashtag = searchParams.get('t')
    if (hashtag) {
      setData({ type: 'hashtag' })
      setTitle(`# ${hashtag}`)
      setSubRequests([
        {
          filter: { '#t': [hashtag], ...(kinds.length > 0 ? { kinds } : {}) },
          urls: FAST_READ_RELAY_URLS
        }
      ])
      // Set controls for hashtag subscribe button - check subscription status
      const isSubscribedToHashtag = isSubscribed(hashtag)
      if (pubkey) {
        setControls(
          <Button
            variant="ghost"
            className="h-10 [&_svg]:size-3"
            onClick={handleSubscribeHashtag}
            disabled={isSubscribedToHashtag}
          >
            {isSubscribedToHashtag ? t('Subscribed') : t('Subscribe')} <Plus />
          </Button>
        )
      }
      return
    }
    const search = searchParams.get('s')
      if (search) {
        setData({ type: 'search' })
        setTitle(`${t('Search')}: ${search}`)
        setSubRequests([
          {
            filter: { search, ...(kinds.length > 0 ? { kinds } : {}) },
            urls: SEARCHABLE_RELAY_URLS
          }
        ])
        return
      }
      const externalContentId = searchParams.get('i')
      if (externalContentId) {
        setData({ type: 'externalContent' })
        setTitle(externalContentId)
        setSubRequests([
          {
            filter: { '#I': [externalContentId], ...(kinds.length > 0 ? { kinds } : {}) },
            urls: Array.from(new Set([
              ...FAST_READ_RELAY_URLS.map(url => normalizeUrl(url) || url),
              ...(relayList?.write || []).map(url => normalizeUrl(url) || url)
            ]))
          }
        ])
        return
      }
      const domain = searchParams.get('d')
      if (domain) {
        // Check if it looks like a domain (contains a dot) or is a d-tag search
        const looksLikeDomain = domain.includes('.')
        
        if (looksLikeDomain) {
          // Domain lookup (NIP-05)
          setTitle(
            <div className="flex items-center gap-1">
              {domain}
              <Favicon domain={domain} className="w-5 h-5" />
            </div>
          )
          const pubkeys = await fetchPubkeysFromDomain(domain)
          setData({
            type: 'domain',
            domain
          })
          if (pubkeys.length) {
            setSubRequests(await client.generateSubRequestsForPubkeys(pubkeys, pubkey))
            setControls(
              <Button
                variant="ghost"
                className="h-10 [&_svg]:size-3"
                onClick={() => push(toProfileList({ domain }))}
              >
                {pubkeys.length.toLocaleString()} <UserRound />
              </Button>
            )
          } else {
            setSubRequests([])
          }
        } else {
          // D-tag search - filter events by d-tag value
          setTitle(`D-Tag: ${domain}`)
          setData({
            type: 'dtag',
            dtag: domain,
            kinds: kinds.length > 0 ? kinds : undefined
          })
          // Filter by d-tag - we'll need to fetch events that have this d-tag
          // For replaceable events, the d-tag is in the 'd' tag position
          const filter: any = {
            '#d': [domain]
          }
          if (kinds.length > 0) {
            filter.kinds = kinds
          }
          setSubRequests([
            {
              filter,
              urls: FAST_READ_RELAY_URLS
            }
          ])
        }
        return
      }
      
      // Advanced search parameters removed
      // Note: Only hashtag (t=) and kind (k=) URL parameters are supported
      // Date searches, pubkey filters, and event filters removed - not supported
  }, [pubkey, relayList, handleSubscribeHashtag, push, t, isSubscribed, subscribe, client])

  // Initialize on mount
  useEffect(() => {
    initializeFromUrl()
  }, [initializeFromUrl])

  // Listen for URL changes to re-initialize the page
  useEffect(() => {
    const handleLocationChange = () => {
      initializeFromUrl()
    }
    
    // Listen for browser back/forward navigation
    window.addEventListener('popstate', handleLocationChange)
    // Listen for custom hashtag navigation events
    window.addEventListener('hashtag-navigation', handleLocationChange)
    
    return () => {
      window.removeEventListener('popstate', handleLocationChange)
      window.removeEventListener('hashtag-navigation', handleLocationChange)
    }
  }, [initializeFromUrl])

  // Update controls when subscription status changes
  useEffect(() => {
    if (data?.type === 'hashtag' && pubkey) {
      setControls(
        <Button
          variant="ghost"
          className="h-10 [&_svg]:size-3"
          onClick={handleSubscribeHashtag}
          disabled={isHashtagSubscribed}
        >
          {isHashtagSubscribed ? t('Subscribed') : t('Subscribe')} <Plus />
        </Button>
      )
    }
  }, [data, pubkey, isHashtagSubscribed, handleSubscribeHashtag, t])

  let content: React.ReactNode = null
  if (data?.type === 'domain' && subRequests.length === 0) {
    content = (
      <div className="text-center w-full py-10">
        <span className="text-muted-foreground">
          {t('No pubkeys found from {url}', { url: getWellKnownNip05Url(data.domain) })}
        </span>
      </div>
    )
  } else if (data) {
    content = <NormalFeed subRequests={subRequests} />
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : title}
      controls={hideTitlebar ? undefined : controls}
      displayScrollToTopButton
    >
      {hideTitlebar && (data?.type === 'hashtag' || data?.type === 'dtag') ? (
        <>
          <div className="px-4 py-2 border-b">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{title}</div>
              {controls}
            </div>
          </div>
          <div className="pt-4">{content}</div>
        </>
      ) : (
        content
      )}
    </SecondaryPageLayout>
  )
})
NoteListPage.displayName = 'NoteListPage'
export default NoteListPage
