import { RefreshButton } from '@/components/RefreshButton'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useSecondaryPage, useSmartNoteNavigation } from '@/PageManager'
import { ExtendedKind } from '@/constants'
import ContentPreview from '@/components/ContentPreview'
import client from '@/services/client.service'
import Note from '@/components/Note'
import NoteBoostBadges from '@/components/NoteBoostBadges'
import NoteInteractions from '@/components/NoteInteractions'
import NoteStats from '@/components/NoteStats'
import UserAvatar from '@/components/UserAvatar'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useFetchEvent, useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { getParentBech32Id, getParentETag, getRootBech32Id } from '@/lib/event'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNote, toNoteList } from '@/lib/link'
import { tagNameEquals } from '@/lib/tag'
import { cn } from '@/lib/utils'
import { Ellipsis } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { kinds, nip19 } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NOSTR_URI_NADDR_REGEX } from '@/lib/content-patterns'
import NotFound from './NotFound'

// Helper function to get event type name (matching WebPreview)
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
    case ExtendedKind.CALENDAR_EVENT_TIME:
    case ExtendedKind.CALENDAR_EVENT_DATE:
      return 'Calendar Event'
    default:
      return `Event (kind ${kind})`
  }
}

// Helper function to extract and strip markdown/asciidoc for preview (matching WebPreview)
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

const NotePage = forwardRef(({ id, index, hideTitlebar = false, initialEvent }: { id?: string; index?: number; hideTitlebar?: boolean; initialEvent?: Event }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const { event, isFetching, refetch: refetchMain } = useFetchEvent(id, initialEvent)
  const [externalEvent, setExternalEvent] = useState<Event | undefined>(undefined)
  const finalEvent = event || externalEvent
  
  const parentEventId = useMemo(() => getParentBech32Id(finalEvent), [finalEvent])
  const rootEventId = useMemo(() => getRootBech32Id(finalEvent), [finalEvent])
  const rootITag = useMemo(
    () => (finalEvent?.kind === ExtendedKind.COMMENT ? finalEvent.tags.find(tagNameEquals('I')) : undefined),
    [finalEvent]
  )
  const { isFetching: isFetchingRootEvent, event: rootEvent, refetch: refetchRoot } =
    useFetchEvent(rootEventId)
  const { isFetching: isFetchingParentEvent, event: parentEvent, refetch: refetchParent } =
    useFetchEvent(parentEventId)

  // When viewing a kind-24 invite (e.g. from notifications), extract calendar event naddr from content and show full calendar card with RSVP
  const calendarInviteNaddr = useMemo(() => {
    if (finalEvent?.kind !== ExtendedKind.PUBLIC_MESSAGE || !finalEvent.content?.trim()) return undefined
    const match = NOSTR_URI_NADDR_REGEX.exec(finalEvent.content)
    NOSTR_URI_NADDR_REGEX.lastIndex = 0
    const naddr = match?.[1]
    if (!naddr) return undefined
    try {
      const decoded = nip19.decode(naddr)
      if (decoded.type === 'naddr' && (decoded.data.kind === ExtendedKind.CALENDAR_EVENT_DATE || decoded.data.kind === ExtendedKind.CALENDAR_EVENT_TIME)) {
        return naddr
      }
    } catch {
      // ignore decode errors
    }
    return undefined
  }, [finalEvent?.kind, finalEvent?.content])
  const { event: calendarInviteEvent, refetch: refetchCalendarInvite } = useFetchEvent(calendarInviteNaddr)

  const refreshNoteData = useCallback(() => {
    refetchMain()
    refetchRoot()
    refetchParent()
    refetchCalendarInvite()
  }, [refetchMain, refetchRoot, refetchParent, refetchCalendarInvite])

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(refreshNoteData)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, refreshNoteData])

  const titlebarRefreshControls = hideTitlebar ? undefined : <RefreshButton onClick={refreshNoteData} />

  // Fetch profile for author (for OpenGraph metadata)
  const { profile: authorProfile } = useFetchProfile(finalEvent?.pubkey)

  const getNoteTypeTitle = (kind: number): string => {
    switch (kind) {
      case 1: // kinds.ShortTextNote
        return 'Note: Text Post'
      case 30023: // kinds.LongFormArticle
        return 'Note: Longform Article'
      case 30040: // ExtendedKind.PUBLICATION
        return 'Note: Publication'
      case 30041: // ExtendedKind.PUBLICATION_CONTENT
        return 'Note: Publication Content'
      case 30817: // ExtendedKind.WIKI_ARTICLE_MARKDOWN
        return 'Note: Wiki Article'
      case 30818: // ExtendedKind.WIKI_ARTICLE
        return 'Note: Wiki Article'
      case 20: // ExtendedKind.PICTURE
        return 'Note: Picture'
      case 21: // ExtendedKind.VIDEO
        return 'Note: Video'
      case 22: // ExtendedKind.SHORT_VIDEO
        return 'Note: Short Video'
      case 11: // ExtendedKind.DISCUSSION
        return 'Discussions'
      case 9802: // kinds.Highlights
        return 'Note: Highlight'
      case 1068: // ExtendedKind.POLL
        return 'Note: Poll'
      case 31987: // ExtendedKind.RELAY_REVIEW
        return 'Note: Relay Review'
      case 31922: // ExtendedKind.CALENDAR_EVENT_DATE
      case 31923: // ExtendedKind.CALENDAR_EVENT_TIME
        return 'Note: Calendar Event'
      case 9735: // ExtendedKind.ZAP_RECEIPT
        return 'Note: Zap Receipt'
      case 6: // kinds.Repost (Nostr boost)
        return 'Note: Boost'
      case 7: // kinds.Reaction
        return 'Note: Reaction'
      case 1111: // ExtendedKind.COMMENT
        return 'Note: Comment'
      case 1222: // ExtendedKind.VOICE
        return 'Note: Voice Post'
      case 1244: // ExtendedKind.VOICE_COMMENT
        return 'Note: Voice Comment'
      default:
        return 'Note'
    }
  }

  // Get article metadata for OpenGraph tags
  const articleMetadata = useMemo(() => {
    if (!finalEvent) return null
    const articleKinds = [
      kinds.LongFormArticle, // 30023
      ExtendedKind.PUBLICATION, // 30040
      ExtendedKind.PUBLICATION_CONTENT, // 30041
      ExtendedKind.WIKI_ARTICLE_MARKDOWN, // 30817
      ExtendedKind.WIKI_ARTICLE // 30818
    ]
    if (articleKinds.includes(finalEvent.kind)) {
      return getLongFormArticleMetadataFromEvent(finalEvent)
    }
    return null
  }, [finalEvent])

  // Store title in sessionStorage for primary note view when hideTitlebar is true
  // This must be called before any early returns to follow Rules of Hooks
  useEffect(() => {
    if (hideTitlebar && finalEvent) {
      const title = getNoteTypeTitle(finalEvent.kind)
      sessionStorage.setItem('notePageTitle', title)
      // Trigger a re-render of the primary view title by dispatching a custom event
      window.dispatchEvent(new Event('notePageTitleUpdated'))
    }
  }, [hideTitlebar, finalEvent])

  // Helper function to update or create meta tags
  function updateMetaTag(property: string, content: string) {
    // Remove property prefix if present (e.g., 'og:title' or 'property="og:title"')
    const prop = property.startsWith('og:') || property.startsWith('article:') ? property : property.replace(/^property="|"$/, '')
    
    // Handle Twitter card tags (they use name attribute, not property)
    const isTwitterTag = prop.startsWith('twitter:')
    const selector = isTwitterTag ? `meta[name="${prop}"]` : `meta[property="${prop}"]`
    
    let meta = document.querySelector(selector)
    if (!meta) {
      meta = document.createElement('meta')
      if (isTwitterTag) {
        meta.setAttribute('name', prop)
      } else {
        meta.setAttribute('property', prop)
      }
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', content)
  }

  // Update OpenGraph metadata to match fallback cards
  useEffect(() => {
    if (!finalEvent) {
      // Reset to default meta tags with richer information
      const defaultUrl = window.location.href
      const truncatedDefaultUrl = defaultUrl.length > 150 ? defaultUrl.substring(0, 147) + '...' : defaultUrl
      updateMetaTag('og:title', 'Jumble - Imwald Edition 🌲')
      updateMetaTag('og:description', `${truncatedDefaultUrl} - A user-friendly Nostr client focused on relay feed browsing and relay discovery. The Imwald edition focuses on publications and articles.`)
      updateMetaTag('og:image', 'https://github.com/CodyTseng/jumble/blob/master/resources/og-image.png?raw=true')
      updateMetaTag('og:type', 'website')
      updateMetaTag('og:url', window.location.href)
      updateMetaTag('og:site_name', 'Jumble - Imwald Edition 🌲')
      
      // Twitter card meta tags
      updateMetaTag('twitter:card', 'summary_large_image')
      updateMetaTag('twitter:title', 'Jumble - Imwald Edition 🌲')
      updateMetaTag('twitter:description', `${truncatedDefaultUrl} - A user-friendly Nostr client focused on relay feed browsing and relay discovery. The Imwald edition focuses on publications and articles.`)
      updateMetaTag('twitter:image', 'https://github.com/CodyTseng/jumble/blob/master/resources/og-image.png?raw=true')
      
      // Remove article:tag if it exists
      const articleTagMeta = document.querySelector('meta[property="article:tag"]')
      if (articleTagMeta) {
        articleTagMeta.remove()
      }
      
      return
    }

    // Get event metadata matching fallback card format
    const eventMetadata = getLongFormArticleMetadataFromEvent(finalEvent)
    const eventTypeName = getEventTypeName(finalEvent.kind)
    const eventTitle = eventMetadata?.title || eventTypeName
    const eventSummary = eventMetadata?.summary || ''
    
    // Generate content preview (matching fallback card)
    let contentPreview = ''
    if (finalEvent.content) {
      const stripped = stripMarkdown(finalEvent.content)
      contentPreview = stripped.length > 500 ? stripped.substring(0, 500) + '...' : stripped
    }
    
    // Build description matching fallback card: username • event type, title, summary, content preview, URL
    // Always show note-specific info, even if profile isn't loaded yet
    const authorName = authorProfile?.username || ''
    const parts: string[] = []
    
    // Always include event type (this is note-specific)
    if (eventTypeName) {
      parts.push(eventTypeName)
    }
    if (authorName) {
      parts.push(`@${authorName}`)
    }
    
    let ogDescription = ''
    if (parts.length > 0) {
      ogDescription = parts.join(' • ')
    } else {
      // Fallback if nothing available yet
      ogDescription = 'Event'
    }
    
    // Always show title if available (note-specific)
    if (eventTitle && eventTitle !== eventTypeName) {
      ogDescription += (ogDescription ? ' | ' : '') + eventTitle
    }
    
    // Show summary if available (note-specific)
    if (eventSummary) {
      ogDescription += (ogDescription ? ' - ' : '') + eventSummary
    }
    
    // Truncate URL to 150 chars before adding it
    const fullUrl = window.location.href
    const truncatedUrl = fullUrl.length > 150 ? fullUrl.substring(0, 147) + '...' : fullUrl
    
    // Calculate remaining space for content preview (max 300 chars total, leave room for URL)
    const maxDescLength = 300
    const urlPart = ` | ${truncatedUrl}`
    const remainingLength = maxDescLength - (ogDescription.length + urlPart.length)
    
    // Always try to include content preview if available (this is note-specific!)
    if (contentPreview && remainingLength > 20) {
      const truncatedContent = contentPreview.length > remainingLength 
        ? contentPreview.substring(0, remainingLength - 3) + '...' 
        : contentPreview
      ogDescription += (ogDescription ? ' ' : '') + truncatedContent
    }
    
    // Add truncated URL at the end
    ogDescription += (ogDescription ? urlPart : truncatedUrl)
    
    // Ensure we have note-specific content - if description is still too generic, add more event info
    if (!authorName && !eventSummary && !contentPreview && ogDescription.includes('Event') && !ogDescription.includes('|')) {
      // Add at least the event kind or some identifier to make it note-specific
      ogDescription = ogDescription.replace('Event', `${eventTypeName} (kind ${finalEvent.kind})`)
    }

    // Prioritize event image, then author avatar, then default
    // Use a beautiful green-themed image with profile data
    let image = eventMetadata?.image
    if (!image && authorProfile?.avatar) {
      image = `https://jumble.imwald.eu/api/avatar/${authorProfile.pubkey}`
    }
    if (!image) {
      // Use default OG image with green forest theme
      image = 'https://github.com/CodyTseng/jumble/blob/master/resources/og-image.png?raw=true'
    }
    
    const tags = eventMetadata?.tags || []
    
    // For articles, use article type; for other events, use website type
    const isArticle = articleMetadata !== null
    const ogType = isArticle ? 'article' : 'website'

    // Enhanced title with profile info
    const ogTitle = authorName 
      ? `${eventTitle} by @${authorName} - Jumble Imwald Edition 🌲`
      : `${eventTitle} - Jumble Imwald Edition 🌲`

    updateMetaTag('og:title', ogTitle)
    updateMetaTag('og:description', ogDescription)
    updateMetaTag('og:image', image)
    updateMetaTag('og:image:width', '1200')
    updateMetaTag('og:image:height', '630')
    updateMetaTag('og:image:alt', `${eventTitle}${authorName ? ` by @${authorName}` : ''} on Jumble Imwald`)
    updateMetaTag('og:type', ogType)
    updateMetaTag('og:url', window.location.href)
    updateMetaTag('og:site_name', 'Jumble - Imwald Edition 🌲')
    
    // Add profile data - always include if available
    if (authorProfile) {
      if (authorProfile.username) {
        updateMetaTag('profile:username', authorProfile.username)
      }
      if (authorProfile.nip05) {
        updateMetaTag('profile:username', authorProfile.nip05)
      }
    }
    
    // Add author for articles
    if (isArticle && authorName) {
      updateMetaTag('article:author', authorName)
      if (authorProfile?.nip05) {
        // Add author URL if NIP-05 is available
        const authorUrl = `https://jumble.imwald.eu/profiles/${finalEvent.pubkey}`
        updateMetaTag('article:author:url', authorUrl)
      }
    }
    
    // Twitter card meta tags
    updateMetaTag('twitter:card', 'summary_large_image')
    updateMetaTag('twitter:title', ogTitle)
    updateMetaTag('twitter:description', ogDescription.length > 200 ? ogDescription.substring(0, 197) + '...' : ogDescription)
    updateMetaTag('twitter:image', image)
    updateMetaTag('twitter:image:alt', `${eventTitle}${authorName ? ` by @${authorName}` : ''} on Jumble Imwald`)
    
    // Remove old article:tag if it exists
    const oldArticleTagMeta = document.querySelector('meta[property="article:tag"]')
    if (oldArticleTagMeta) {
      oldArticleTagMeta.remove()
    }
    
    // Add article-specific tags (one meta tag per tag)
    if (isArticle) {
      tags.forEach(tag => {
        const tagMeta = document.createElement('meta')
        tagMeta.setAttribute('property', 'article:tag')
        tagMeta.setAttribute('content', tag)
        document.head.appendChild(tagMeta)
      })
    }

    // Update document title
    document.title = `${eventTitle} - Jumble Imwald Edition`

    // Cleanup function
    return () => {
      // Reset to default on unmount with richer information
      const cleanupUrl = window.location.href
      const truncatedCleanupUrl = cleanupUrl.length > 150 ? cleanupUrl.substring(0, 147) + '...' : cleanupUrl
      updateMetaTag('og:title', 'Jumble - Imwald Edition 🌲')
      updateMetaTag('og:description', `${truncatedCleanupUrl} - A user-friendly Nostr client focused on relay feed browsing and relay discovery. The Imwald edition focuses on publications and articles.`)
      updateMetaTag('og:image', 'https://github.com/CodyTseng/jumble/blob/master/resources/og-image.png?raw=true')
      updateMetaTag('og:type', 'website')
      updateMetaTag('og:url', window.location.href)
      updateMetaTag('og:site_name', 'Jumble - Imwald Edition 🌲')
      
      // Remove article:tag meta tags
      document.querySelectorAll('meta[property="article:tag"]').forEach(meta => meta.remove())
      const authorMeta = document.querySelector('meta[property="article:author"]')
      if (authorMeta) {
        authorMeta.remove()
      }
      
      document.title = 'Jumble - Imwald Edition 🌲'
    }
  }, [finalEvent, articleMetadata, authorProfile])

  if (!event && isFetching) {
    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('Note')}
        controls={titlebarRefreshControls}
      >
        <div className="px-4 pt-3">
          <div className="flex items-center space-x-2">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className={`flex-1 w-0`}>
              <div className="py-1">
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="py-0.5">
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          </div>
          <div className="pt-2">
            <div className="my-1">
              <Skeleton className="w-full h-4 my-1 mt-2" />
            </div>
            <div className="my-1">
              <Skeleton className="w-2/3 h-4 my-1" />
            </div>
          </div>
        </div>
      </SecondaryPageLayout>
    )
  }
  if (!finalEvent) {
    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('Note')}
        controls={titlebarRefreshControls}
        displayScrollToTopButton
      >
        <NotFound bech32Id={id} onEventFound={setExternalEvent} />
      </SecondaryPageLayout>
    )
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : getNoteTypeTitle(finalEvent.kind)}
      controls={titlebarRefreshControls}
      displayScrollToTopButton
    >
      <div className="px-4 pt-3 w-full">
        {rootITag && <ExternalRoot value={rootITag[1]} />}
        {rootEventId && rootEventId !== parentEventId && (
          <ParentNote
            key={`root-note-${finalEvent.id}`}
            isFetching={isFetchingRootEvent}
            event={rootEvent}
            eventBech32Id={rootEventId}
            isConsecutive={isConsecutive(rootEvent, parentEvent)}
          />
        )}
        {parentEventId && (
          <ParentNote
            key={`parent-note-${finalEvent.id}`}
            isFetching={isFetchingParentEvent}
            event={parentEvent}
            eventBech32Id={parentEventId}
          />
        )}
        <Note
          key={`note-${finalEvent.id}`}
          event={finalEvent}
          className="select-text"
          hideParentNotePreview
          originalNoteId={id}
          showFull
          fullCalendarInvite={
            calendarInviteEvent && calendarInviteNaddr
              ? { event: calendarInviteEvent, naddr: calendarInviteNaddr }
              : undefined
          }
        />
        <NoteBoostBadges event={finalEvent} className="mt-2" />
        <NoteStats className="mt-3" event={finalEvent} fetchIfNotExisting displayTopZapsAndLikes />
      </div>
      <Separator className="mt-4" />
      <div className="px-4 pb-4 w-full">
        <NoteInteractions key={`note-interactions-${finalEvent.id}`} pageIndex={index} event={finalEvent} />
      </div>
    </SecondaryPageLayout>
  )
})
NotePage.displayName = 'NotePage'
export default NotePage

function ExternalRoot({ value }: { value: string }) {
  const { push } = useSecondaryPage()

  return (
    <div>
      <Card
        className="flex space-x-1 px-1.5 py-1 items-center clickable text-sm text-muted-foreground hover:text-foreground"
        onClick={() => {
          // For external content, we still use secondary page navigation
          push(toNoteList({ externalContentId: value }))
        }}
      >
        <div className="truncate">{value}</div>
      </Card>
      <div className="ml-5 w-px h-2 bg-border" />
    </div>
  )
}

function ParentNote({
  event,
  eventBech32Id,
  isFetching,
  isConsecutive = true
}: {
  event?: Event
  eventBech32Id: string
  isFetching: boolean
  isConsecutive?: boolean
}) {
  const { navigateToNote } = useSmartNoteNavigation()

  if (isFetching) {
    return (
      <div>
        <div className="flex space-x-1 px-[0.4375rem] py-1 items-center rounded-full border clickable text-sm text-muted-foreground">
          <Skeleton className="shrink w-4 h-4 rounded-full" />
          <div className="py-1 flex-1">
            <Skeleton className="h-3" />
          </div>
        </div>
        <div className="ml-5 w-px h-3 bg-border" />
      </div>
    )
  }

  return (
    <div>
      <div
        className={cn(
          'flex space-x-1 px-[0.4375rem] py-1 items-center rounded-full border clickable text-sm text-muted-foreground',
          event && 'hover:text-foreground'
        )}
        onClick={(e) => {
          e.stopPropagation()
          if (event) client.addEventToCache(event)
          navigateToNote(toNote(event ?? eventBech32Id))
        }}
      >
        {event && <UserAvatar userId={event.pubkey} size="tiny" className="shrink-0" />}
        <div 
          className="truncate flex-1"
          onClick={(e) => {
            e.stopPropagation()
            if (event) client.addEventToCache(event)
            navigateToNote(toNote(event ?? eventBech32Id))
          }}
        >
          <ContentPreview event={event} />
        </div>
      </div>
      {isConsecutive ? (
        <div className="ml-5 w-px h-3 bg-border" />
      ) : (
        <Ellipsis className="ml-3.5 text-muted-foreground/60 size-3" />
      )}
    </div>
  )
}

function isConsecutive(rootEvent?: Event, parentEvent?: Event) {
  const eTag = getParentETag(parentEvent)
  if (!eTag) return false

  return rootEvent?.id === eTag[1]
}
