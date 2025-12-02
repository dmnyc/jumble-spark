import { useFetchWebMetadata } from '@/hooks/useFetchWebMetadata'
import { useFetchEvent } from '@/hooks/useFetchEvent'
import { useFetchProfile } from '@/hooks/useFetchProfile'
import { ExtendedKind } from '@/constants'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ExternalLink } from 'lucide-react'
import { nip19, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import Image from '../Image'
import Username from '../Username'
import { cleanUrl } from '@/lib/url'
import { tagNameEquals } from '@/lib/tag'

// Helper function to get event type name
function getEventTypeName(kind: number): string {
  switch (kind) {
    case kinds.ShortTextNote:
      return 'Text Post'
    case kinds.LongFormArticle:
      return 'Longform Article'
    case ExtendedKind.PICTURE:
      return 'Picture'
    case ExtendedKind.VIDEO:
      return 'Video'
    case ExtendedKind.SHORT_VIDEO:
      return 'Short Video'
    case ExtendedKind.POLL:
      return 'Poll'
    case ExtendedKind.COMMENT:
      return 'Comment'
    case ExtendedKind.VOICE:
      return 'Voice Post'
    case ExtendedKind.VOICE_COMMENT:
      return 'Voice Comment'
    case kinds.Highlights:
      return 'Highlight'
    case ExtendedKind.PUBLICATION:
      return 'Publication'
    case ExtendedKind.PUBLICATION_CONTENT:
      return 'Publication Content'
    case ExtendedKind.WIKI_ARTICLE:
      return 'Wiki Article'
    case ExtendedKind.WIKI_ARTICLE_MARKDOWN:
      return 'Wiki Article'
    case ExtendedKind.DISCUSSION:
      return 'Discussion'
    default:
      return `Event (kind ${kind})`
  }
}

// Helper function to extract and strip markdown/asciidoc for preview
function stripMarkdown(content: string): string {
  let text = content
  // Remove markdown headers
  text = text.replace(/^#{1,6}\s+/gm, '')
  // Remove markdown bold/italic
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  // Remove markdown links
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  // Remove asciidoc headers
  text = text.replace(/^=+\s+/gm, '')
  // Remove asciidoc bold/italic
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')
  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, '')
  text = text.replace(/`([^`]+)`/g, '$1')
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '')
  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

export default function WebPreview({ url, className }: { url: string; className?: string }) {
  const { autoLoadMedia } = useContentPolicy()
  const { isSmallScreen } = useScreenSize()

  const cleanedUrl = useMemo(() => cleanUrl(url), [url])
  const { title, description, image } = useFetchWebMetadata(cleanedUrl)

  const hostname = useMemo(() => {
    try {
      return new URL(cleanedUrl).hostname
    } catch {
      return ''
    }
  }, [cleanedUrl])

  const isInternalJumbleLink = useMemo(() => hostname === 'jumble.imwald.eu', [hostname])

  // Extract nostr identifier from URL
  const nostrIdentifier = useMemo(() => {
    const naddrMatch = cleanedUrl.match(/(naddr1[a-z0-9]+)/i)
    const neventMatch = cleanedUrl.match(/(nevent1[a-z0-9]+)/i)
    const noteMatch = cleanedUrl.match(/(note1[a-z0-9]{58})/i)
    const npubMatch = cleanedUrl.match(/(npub1[a-z0-9]{58})/i)
    const nprofileMatch = cleanedUrl.match(/(nprofile1[a-z0-9]+)/i)
    
    return naddrMatch?.[1] || neventMatch?.[1] || noteMatch?.[1] || npubMatch?.[1] || nprofileMatch?.[1] || null
  }, [cleanedUrl])

  // Determine nostr type and extract details
  const nostrDetails = useMemo(() => {
    if (!nostrIdentifier) return null
    try {
      const decoded = nip19.decode(nostrIdentifier)
      const details: {
        type: string
        hexId?: string
        dTag?: string
        kind?: number
        pubkey?: string
        identifier?: string
      } = { type: decoded.type }
      
      if (decoded.type === 'note') {
        details.hexId = decoded.data
      } else if (decoded.type === 'nevent') {
        details.hexId = decoded.data.id
        details.kind = decoded.data.kind
        details.pubkey = decoded.data.author
      } else if (decoded.type === 'naddr') {
        details.kind = decoded.data.kind
        details.pubkey = decoded.data.pubkey
        details.identifier = decoded.data.identifier
        details.dTag = decoded.data.identifier
      } else if (decoded.type === 'npub') {
        details.pubkey = decoded.data
      } else if (decoded.type === 'nprofile') {
        details.pubkey = decoded.data.pubkey
      }
      
      return details
    } catch {
      return null
    }
  }, [nostrIdentifier])
  
  const nostrType = nostrDetails?.type || null

  // Fetch profile for npub/nprofile
  const profileId = nostrType === 'npub' || nostrType === 'nprofile' ? (nostrIdentifier || undefined) : undefined
  const { profile: fetchedProfile, isFetching: isFetchingProfile } = useFetchProfile(profileId)

  // Fetch event for naddr/nevent/note
  const eventId = (nostrType === 'naddr' || nostrType === 'nevent' || nostrType === 'note') ? (nostrIdentifier || undefined) : undefined
  const { event: fetchedEvent, isFetching: isFetchingEvent } = useFetchEvent(eventId)
  
  // Extract d-tag from fetched event if available
  const eventDTag = useMemo(() => {
    if (fetchedEvent) {
      return fetchedEvent.tags.find(tagNameEquals('d'))?.[1]
    }
    return nostrDetails?.dTag
  }, [fetchedEvent, nostrDetails])

  // Get content preview (first 500 chars, stripped of markdown) - ALWAYS call hooks before any returns
  const contentPreview = useMemo(() => {
    if (!fetchedEvent?.content) return ''
    const stripped = stripMarkdown(fetchedEvent.content)
    return stripped.length > 500 ? stripped.substring(0, 500) + '...' : stripped
  }, [fetchedEvent])

  // Early return after ALL hooks are called
  if (!autoLoadMedia) {
    return null
  }

  // Always try to fetch OG data for standalone hyperlinks (except internal jumble links)
  // Check if we have any opengraph data (title, description, or image)
  const hasOpengraphData = !isInternalJumbleLink && (title || description || image)

  // If no opengraph metadata available, show enhanced fallback link card
  // Note: We always attempt to fetch OG data via useFetchWebMetadata hook above
  if (!hasOpengraphData) {
    // Enhanced card for event URLs (always show if nostr identifier detected, even while loading)
    if (nostrType === 'naddr' || nostrType === 'nevent' || nostrType === 'note') {
      const eventMetadata = fetchedEvent ? getLongFormArticleMetadataFromEvent(fetchedEvent) : null
      const eventTypeName = fetchedEvent ? getEventTypeName(fetchedEvent.kind) : null
      const eventTitle = eventMetadata?.title || eventTypeName
      const eventSummary = eventMetadata?.summary || description
      const eventImage = eventMetadata?.image

      // Extract bookstr metadata if applicable
      const bookMetadata = fetchedEvent ? extractBookMetadata(fetchedEvent) : null
      const isBookstrEvent = fetchedEvent && (fetchedEvent.kind === ExtendedKind.PUBLICATION || fetchedEvent.kind === ExtendedKind.PUBLICATION_CONTENT) && !!bookMetadata?.book

      const formatBookName = (book: string) => {
        return book
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ')
      }
      
      // Build identifier details
      const identifierParts: string[] = []
      if (nostrDetails?.hexId) {
        identifierParts.push(`Hex: ${nostrDetails.hexId.substring(0, 16)}...`)
      }
      if (eventDTag) {
        identifierParts.push(`d-tag: ${eventDTag}`)
      } else if (nostrDetails?.dTag) {
        identifierParts.push(`d-tag: ${nostrDetails.dTag}`)
      }
      if (nostrDetails?.kind) {
        identifierParts.push(`kind: ${nostrDetails.kind}`)
      }
      if (nostrType) {
        identifierParts.push(`Type: ${nostrType}`)
      }

      return (
        <div
          className={cn('p-3 clickable flex w-full border rounded-lg overflow-hidden gap-3 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20', className)}
          onClick={(e) => {
            e.stopPropagation()
            window.open(cleanedUrl, '_blank')
          }}
        >
          {eventImage && fetchedEvent && (
            <Image
              image={{ url: eventImage, pubkey: fetchedEvent.pubkey }}
              className="w-20 h-20 rounded-lg flex-shrink-0 object-cover border border-green-200 dark:border-green-800"
              hideIfError
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {fetchedEvent ? (
                <>
                  <Username userId={fetchedEvent.pubkey} className="text-xs" />
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground">{eventTypeName}</span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {isFetchingEvent ? 'Loading event...' : 'Event'}
                </span>
              )}
              <ExternalLink className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0 ml-auto" />
            </div>
            {fetchedEvent && (
              <>
                {eventTitle && (
                  <div className="font-semibold text-sm line-clamp-2 mb-1 text-green-900 dark:text-green-100">{eventTitle}</div>
                )}
                {isBookstrEvent && bookMetadata && (
                  <div className="text-xs text-muted-foreground space-x-2 mb-1">
                    {bookMetadata.type && <span>Type: {bookMetadata.type}</span>}
                    {bookMetadata.book && <span>Book: {formatBookName(bookMetadata.book)}</span>}
                    {bookMetadata.chapter && <span>Chapter: {bookMetadata.chapter}</span>}
                    {bookMetadata.verse && <span>Verse: {bookMetadata.verse}</span>}
                    {bookMetadata.version && <span>Version: {bookMetadata.version.toUpperCase()}</span>}
                  </div>
                )}
                {eventSummary && (
                  <div className="text-xs text-muted-foreground line-clamp-2 mb-1">{eventSummary}</div>
                )}
                {contentPreview && (
                  <div className="my-2 text-sm whitespace-pre-wrap break-words line-clamp-6">
                    {contentPreview}
                  </div>
                )}
              </>
            )}
            {identifierParts.length > 0 && (
              <div className="text-xs text-muted-foreground space-x-2 mt-2 pt-2 border-t border-green-200 dark:border-green-800">
                {identifierParts.map((part, idx) => (
                  <span key={idx} className="font-mono">{part}</span>
                ))}
              </div>
            )}
            <div className="text-xs text-muted-foreground truncate mt-1">{hostname}</div>
          </div>
        </div>
      )
    }

    // Enhanced card for profile URLs (loading state)
    if (nostrType === 'npub' || nostrType === 'nprofile') {
      // Build identifier details for profile
      const profileIdentifierParts: string[] = []
      if (nostrDetails?.pubkey) {
        profileIdentifierParts.push(`Pubkey: ${nostrDetails.pubkey.substring(0, 16)}...`)
      }
      if (fetchedProfile?.nip05) {
        profileIdentifierParts.push(`NIP-05: ${fetchedProfile.nip05}`)
      }
      if (nostrType) {
        profileIdentifierParts.push(`Type: ${nostrType}`)
      }
      
      return (
        <div
          className={cn('p-3 clickable flex w-full border rounded-lg overflow-hidden gap-3 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20', className)}
          onClick={(e) => {
            e.stopPropagation()
            window.open(cleanedUrl, '_blank')
          }}
        >
          {fetchedProfile?.avatar && (
            <Image
              image={{ url: fetchedProfile.avatar, pubkey: fetchedProfile.pubkey }}
              className="w-16 h-16 rounded-lg flex-shrink-0 object-cover border border-green-200 dark:border-green-800"
              hideIfError
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {fetchedProfile ? (
                <>
                  <Username userId={fetchedProfile.pubkey} />
                  {fetchedProfile.nip05 && (
                    <>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-green-600 dark:text-green-400">{fetchedProfile.nip05}</span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {isFetchingProfile ? 'Loading profile...' : 'Profile'}
                </span>
              )}
              <ExternalLink className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0 ml-auto" />
            </div>
            {fetchedProfile?.about && (
              <div className="text-xs text-muted-foreground line-clamp-2 mb-1 mt-1">{fetchedProfile.about}</div>
            )}
            {profileIdentifierParts.length > 0 && (
              <div className="text-xs text-muted-foreground space-x-2 mt-2 pt-2 border-t border-green-200 dark:border-green-800">
                {profileIdentifierParts.map((part, idx) => (
                  <span key={idx} className="font-mono">{part}</span>
                ))}
              </div>
            )}
            <div className="text-xs text-muted-foreground truncate mt-1">{hostname}</div>
            <div className="text-xs text-muted-foreground truncate">{url}</div>
          </div>
        </div>
      )
    }

    // Basic fallback for non-nostr URLs - show site information
    return (
      <div
        className={cn('p-3 clickable flex w-full border rounded-lg overflow-hidden gap-3 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/20', className)}
        onClick={(e) => {
          e.stopPropagation()
          window.open(cleanedUrl, '_blank')
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-sm font-semibold text-green-900 dark:text-green-100 truncate">{hostname}</div>
            <ExternalLink className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0" />
          </div>
          <div className="text-xs text-muted-foreground break-all line-clamp-2">{cleanedUrl}</div>
        </div>
      </div>
    )
  }

  if (isSmallScreen && image) {
    return (
      <div
        className="rounded-lg border mt-2 overflow-hidden"
        onClick={(e) => {
          e.stopPropagation()
          window.open(cleanedUrl, '_blank')
        }}
      >
        <Image image={{ url: image }} className="w-full max-w-[400px] h-44 rounded-none" hideIfError />
        <div className="bg-muted p-2 w-full">
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground truncate">{hostname}</div>
            <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          </div>
          {title && <div className="font-semibold line-clamp-1">{title}</div>}
          {!title && description && <div className="font-semibold line-clamp-1">{description}</div>}
          <div className="text-xs text-muted-foreground truncate mt-1">{url}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('p-2 clickable flex w-full border rounded-lg overflow-hidden gap-2', className)}
      onClick={(e) => {
        e.stopPropagation()
        window.open(cleanedUrl, '_blank')
      }}
    >
      {image && (
        <Image
          image={{ url: image }}
          className="aspect-[4/3] xl:aspect-video bg-foreground h-44 max-w-[400px] rounded-none flex-shrink-0"
          hideIfError
        />
      )}
      <div className="flex-1 w-0 p-2">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-xs text-muted-foreground truncate">{hostname}</div>
          <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        </div>
        {title && <div className="font-semibold line-clamp-2 mb-1">{title}</div>}
        {description && (
          <div className={cn("line-clamp-3 mb-1", title ? "text-xs text-muted-foreground" : "text-sm font-semibold")}>
            {description}
          </div>
        )}
        <div className="text-xs text-muted-foreground truncate">{url}</div>
      </div>
    </div>
  )
}
