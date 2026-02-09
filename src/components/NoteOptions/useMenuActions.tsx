import { ExtendedKind } from '@/constants'
import { getNoteBech32Id, isProtectedEvent, getRootEventHexId } from '@/lib/event'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toAlexandria } from '@/lib/link'
import logger from '@/lib/logger'
import { pubkeyToNpub } from '@/lib/pubkey'
import { normalizeUrl, simplifyUrl } from '@/lib/url'
import { generateBech32IdFromATag } from '@/lib/tag'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { BIG_RELAY_URLS, FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import client from '@/services/client.service'
import { Bell, BellOff, Code, Copy, Link, SatelliteDish, Trash2, TriangleAlert, Pin, FileDown, Globe, BookOpen, Highlighter } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { useMemo, useState, useEffect, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import RelayIcon from '../RelayIcon'
import { PrimaryPageContext } from '@/PageManager'
import { showPublishingFeedback } from '@/lib/publishing-feedback'

export interface SubMenuAction {
  label: React.ReactNode
  onClick: () => void
  className?: string
  separator?: boolean
}

export interface MenuAction {
  icon: React.ComponentType
  label: string
  onClick?: () => void
  className?: string
  separator?: boolean
  subMenu?: SubMenuAction[]
}

interface UseMenuActionsProps {
  event: Event
  closeDrawer: () => void
  showSubMenuActions: (subMenu: SubMenuAction[], title: string) => void
  setIsRawEventDialogOpen: (open: boolean) => void
  setIsReportDialogOpen: (open: boolean) => void
  isSmallScreen: boolean
  openHighlightEditor?: (highlightData: import('../PostEditor/HighlightEditor').HighlightData, eventContent?: string) => void
}

export function useMenuActions({
  event,
  closeDrawer,
  showSubMenuActions,
  setIsRawEventDialogOpen,
  setIsReportDialogOpen,
  isSmallScreen,
  openHighlightEditor
}: UseMenuActionsProps) {
  const { t } = useTranslation()
  // Use useContext directly to avoid error if provider is not available
  const primaryPageContext = useContext(PrimaryPageContext)
  const currentPrimaryPage = primaryPageContext?.current ?? null
  const { pubkey, attemptDelete, publish } = useNostr()
  const { relayUrls: currentBrowsingRelayUrls } = useCurrentRelays()
  const { relaySets, favoriteRelays } = useFavoriteRelays()
  const relayUrls = useMemo(() => {
    return Array.from(new Set([
      ...currentBrowsingRelayUrls.map(url => normalizeUrl(url) || url),
      ...favoriteRelays.map(url => normalizeUrl(url) || url)
    ]))
  }, [currentBrowsingRelayUrls, favoriteRelays])
  const { mutePubkeyPublicly, mutePubkeyPrivately, unmutePubkey, mutePubkeySet } = useMuteList()
  const isMuted = useMemo(() => mutePubkeySet.has(event.pubkey), [mutePubkeySet, event])
  
  // Check if event is pinned
  const [isPinned, setIsPinned] = useState(false)
  
  useEffect(() => {
    const checkIfPinned = async () => {
      if (!pubkey) {
        setIsPinned(false)
        return
      }
      try {
        // Build comprehensive relay list for pin status check
        const allRelays = [
          ...(currentBrowsingRelayUrls || []),
          ...(favoriteRelays || []),
          ...BIG_RELAY_URLS,
          ...FAST_READ_RELAY_URLS,
          ...FAST_WRITE_RELAY_URLS
        ]
        
        const normalizedRelays = allRelays
          .map(url => normalizeUrl(url))
          .filter((url): url is string => !!url)
        
        const comprehensiveRelays = Array.from(new Set(normalizedRelays))
        
        // Try to fetch pin list event from comprehensive relay list first
        let pinListEvent = null
        try {
          const pinListEvents = await client.fetchEvents(comprehensiveRelays, {
            authors: [pubkey],
            kinds: [10001], // Pin list kind
            limit: 1
          })
          pinListEvent = pinListEvents[0] || null
        } catch (error) {
          logger.component('PinStatus', 'Error fetching pin list from comprehensive relays, falling back to default method', { error: (error as Error).message })
          pinListEvent = await client.fetchPinListEvent(pubkey)
        }
        
        if (pinListEvent) {
          const isEventPinned = pinListEvent.tags.some(tag => tag[0] === 'e' && tag[1] === event.id)
          setIsPinned(isEventPinned)
        }
      } catch (error) {
        logger.component('PinStatus', 'Error checking pin status', { error: (error as Error).message })
      }
    }
    checkIfPinned()
  }, [pubkey, event.id, currentBrowsingRelayUrls, favoriteRelays])
  
  const handlePinNote = async () => {
    if (!pubkey) return
    
    try {
      // Build comprehensive relay list for pin list fetching
      const allRelays = [
        ...(currentBrowsingRelayUrls || []),
        ...(favoriteRelays || []),
        ...BIG_RELAY_URLS,
        ...FAST_READ_RELAY_URLS,
        ...FAST_WRITE_RELAY_URLS
      ]
      
      const normalizedRelays = allRelays
        .map(url => normalizeUrl(url))
        .filter((url): url is string => !!url)
      
      const comprehensiveRelays = Array.from(new Set(normalizedRelays))
      
      // Try to fetch pin list event from comprehensive relay list first
      let pinListEvent = null
      try {
        const pinListEvents = await client.fetchEvents(comprehensiveRelays, {
          authors: [pubkey],
          kinds: [10001], // Pin list kind
          limit: 1
        })
        pinListEvent = pinListEvents[0] || null
      } catch (error) {
        logger.component('PinNote', 'Error fetching pin list from comprehensive relays, falling back to default method', { error: (error as Error).message })
        pinListEvent = await client.fetchPinListEvent(pubkey)
      }
      
      logger.component('PinNote', 'Current pin list event', { hasEvent: !!pinListEvent })
      
      // Get existing event IDs, excluding the one we're toggling
      const existingEventIds = (pinListEvent?.tags || [])
        .filter(tag => tag[0] === 'e' && tag[1])
        .map(tag => tag[1])
        .filter(id => id !== event.id)
      
      logger.component('PinNote', 'Existing event IDs (excluding current)', { count: existingEventIds.length })
      logger.component('PinNote', 'Current event ID', { eventId: event.id })
      logger.component('PinNote', 'Is currently pinned', { isPinned })
      
      let newTags: string[][]
      let successMessage: string
      
      if (isPinned) {
        // Unpin: just keep the existing tags without this event
        newTags = existingEventIds.map(id => ['e', id])
        successMessage = t('Note unpinned')
        logger.component('PinNote', 'Unpinning - new tags', { count: newTags.length })
      } else {
        // Pin: add this event to the existing list
        newTags = [...existingEventIds.map(id => ['e', id]), ['e', event.id]]
        successMessage = t('Note pinned')
        logger.component('PinNote', 'Pinning - new tags', { count: newTags.length })
      }
      
      // Create and publish the new pin list event
      logger.component('PinNote', 'Publishing new pin list event', { tagCount: newTags.length, relayCount: comprehensiveRelays.length })
      const publishedEvent = await publish({
        kind: 10001,
        tags: newTags,
        content: '',
        created_at: Math.floor(Date.now() / 1000)
      }, {
        specifiedRelayUrls: comprehensiveRelays
      })
      
      // Show publishing feedback with relay messages
      if ((publishedEvent as any)?.relayStatuses) {
        showPublishingFeedback({
          success: true,
          relayStatuses: (publishedEvent as any).relayStatuses,
          successCount: (publishedEvent as any).relayStatuses.filter((s: any) => s.success).length,
          totalCount: (publishedEvent as any).relayStatuses.length
        }, {
          message: successMessage,
          duration: 4000
        })
      } else {
        toast.success(successMessage)
      }
      
      // Update local state - the publish will update the cache automatically
      setIsPinned(!isPinned)
      closeDrawer()
    } catch (error) {
      logger.component('PinNote', 'Error pinning/unpinning note', { error: (error as Error).message })
      toast.error(t('Failed to pin note'))
    }
  }
  
  // Check if this is a reply to a discussion event
  const [isReplyToDiscussion, setIsReplyToDiscussion] = useState(false)
  
  useEffect(() => {
    const isDiscussion = event.kind === ExtendedKind.DISCUSSION
    if (isDiscussion) return // Already a discussion event
    
    const rootEventId = getRootEventHexId(event)
    if (rootEventId) {
      // Fetch the root event to check if it's a discussion
      client.fetchEvent(rootEventId).then(rootEvent => {
        if (rootEvent && rootEvent.kind === ExtendedKind.DISCUSSION) {
          setIsReplyToDiscussion(true)
        }
      }).catch(() => {
        // If we can't fetch the root event, assume it's not a discussion reply
        setIsReplyToDiscussion(false)
      })
    }
  }, [event.id, event.kind])

  const broadcastSubMenu: SubMenuAction[] = useMemo(() => {
    const items = []
    if (pubkey && event.pubkey === pubkey) {
      items.push({
        label: <div className="text-left"> {t('Write relays')}</div>,
        onClick: async () => {
          closeDrawer()
          const promise = async () => {
            const relays = await client.determineTargetRelays(event)
            if (relays?.length) {
              await client.publishEvent(relays, event)
            }
          }
          toast.promise(promise, {
            loading: t('Republishing...'),
            success: () => {
              return t('Successfully republish to your write relays')
            },
            error: (err) => {
              return t('Failed to republish to your write relays: {{error}}', {
                error: err.message
              })
            }
          })
        }
      })
    }

    if (relaySets.length) {
      items.push(
        ...relaySets
          .filter((set) => set.relayUrls.length)
          .map((set, index) => ({
            label: <div className="text-left truncate">{set.name}</div>,
            onClick: async () => {
              closeDrawer()
              const promise = client.publishEvent(set.relayUrls, event)
              toast.promise(promise, {
                loading: t('Republishing...'),
                success: () => {
                  return t('Successfully republish to relay set: {{name}}', { name: set.name })
                },
                error: (err) => {
                  return t('Failed to republish to relay set: {{name}}. Error: {{error}}', {
                    name: set.name,
                    error: err.message
                  })
                }
              })
            },
            separator: index === 0
          }))
      )
    }

    if (relayUrls.length) {
      items.push(
        ...relayUrls.map((relay, index) => ({
          label: (
            <div className="flex items-center gap-2 w-full">
              <RelayIcon url={relay} />
              <div className="flex-1 truncate text-left">{simplifyUrl(relay)}</div>
            </div>
          ),
          onClick: async () => {
            closeDrawer()
            const promise = client.publishEvent([relay], event)
            toast.promise(promise, {
              loading: t('Republishing...'),
              success: () => {
                return t('Successfully republish to relay: {{url}}', { url: simplifyUrl(relay) })
              },
              error: (err) => {
                return t('Failed to republish to relay: {{url}}. Error: {{error}}', {
                  url: simplifyUrl(relay),
                  error: err.message
                })
              }
            })
          },
          separator: index === 0
        }))
      )
    }

    return items
  }, [pubkey, relayUrls, relaySets])

  // Check if this is an article-type event
  const isArticleType = useMemo(() => {
    return event.kind === kinds.LongFormArticle ||
           event.kind === ExtendedKind.WIKI_ARTICLE ||
           event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN ||
           event.kind === ExtendedKind.PUBLICATION ||
           event.kind === ExtendedKind.PUBLICATION_CONTENT
  }, [event.kind])

  // Get article metadata for export
  const articleMetadata = useMemo(() => {
    if (!isArticleType) return null
    return getLongFormArticleMetadataFromEvent(event)
  }, [isArticleType, event])

  // Extract d-tag for Wikistr URL
  const dTag = useMemo(() => {
    if (!isArticleType) return ''
    return event.tags.find(tag => tag[0] === 'd')?.[1] || ''
  }, [isArticleType, event])

  // Generate naddr for Alexandria URL
  const naddr = useMemo(() => {
    if (!isArticleType || !dTag) return ''
    try {
      const relays = event.tags
        .filter(tag => tag[0] === 'relay')
        .map(tag => tag[1])
        .filter(Boolean)
      
      return nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag,
        relays: relays.length > 0 ? relays : undefined
      })
    } catch (error) {
      logger.error('Error generating naddr', { error })
      return ''
    }
  }, [isArticleType, event, dTag])

  // Check if this is an OP event that can be highlighted
  const isOPEvent = useMemo(() => {
    return (
      event.kind === kinds.ShortTextNote || // 1
      event.kind === kinds.LongFormArticle || // 30023
      event.kind === ExtendedKind.WIKI_ARTICLE || // 30818
      event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN || // 30817
      event.kind === ExtendedKind.PUBLICATION || // 30040
      event.kind === ExtendedKind.PUBLICATION_CONTENT || // 30041
      event.kind === ExtendedKind.DISCUSSION || // 11
      event.kind === ExtendedKind.COMMENT || // 1111
      (event.kind === kinds.Zap && (event.tags.some(tag => tag[0] === 'e') || event.tags.some(tag => tag[0] === 'a'))) // Zap receipt
    )
  }, [event.kind, event.tags])

  const menuActions: MenuAction[] = useMemo(() => {
    // Export functions for articles
    const exportAsMarkdown = () => {
      if (!isArticleType) return
      
      try {
        const title = articleMetadata?.title || 'Article'
        const content = event.content
        const filename = `${title}.md`
        
        const blob = new Blob([content], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        
        logger.info('[NoteOptions] Exported article as Markdown')
        toast.success(t('Article exported as Markdown'))
      } catch (error) {
        logger.error('[NoteOptions] Error exporting article:', error)
        toast.error(t('Failed to export article'))
      }
    }

    const exportAsAsciidoc = async () => {
      if (!isArticleType) return
      
      try {
        const title = articleMetadata?.title || 'Article'
        let content = event.content
        let filename = `${title}.adoc`
        
        // For publications (30040), export all referenced sections
        if (event.kind === ExtendedKind.PUBLICATION) {
          const contentParts: string[] = []
          
          // Extract all 'a' tag references
          const aTags = event.tags.filter(tag => tag[0] === 'a' && tag[1])
          
          // Fetch all referenced events
          const fetchPromises = aTags.map(async (tag) => {
            try {
              const coordinate = tag[1]
              const [kindStr] = coordinate.split(':')
              const kind = parseInt(kindStr)
              
              if (isNaN(kind)) return null
              
              // Try to fetch the event
              const aTag = ['a', coordinate, tag[2] || '', tag[3] || '']
              const bech32Id = generateBech32IdFromATag(aTag)
              if (bech32Id) {
                const fetchedEvent = await client.fetchEvent(bech32Id)
                return fetchedEvent
              }
              return null
            } catch (error) {
              logger.warn('[NoteOptions] Error fetching referenced event for export:', error)
              return null
            }
          })
          
          const referencedEvents = (await Promise.all(fetchPromises)).filter((e): e is Event => e !== null)
          
          // Combine all events into one AsciiDoc document
          for (const refEvent of referencedEvents) {
            const refTitle = refEvent.tags.find(tag => tag[0] === 'title')?.[1] || 'Untitled'
            contentParts.push(`= ${refTitle}\n\n${refEvent.content}\n\n`)
          }
          
          if (contentParts.length > 0) {
            content = contentParts.join('\n')
          }
        }
        
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        
        logger.info('[NoteOptions] Exported article as AsciiDoc')
        toast.success(t('Article exported as AsciiDoc'))
      } catch (error) {
        logger.error('[NoteOptions] Error exporting article:', error)
        toast.error(t('Failed to export article'))
      }
    }

    // View on external sites functions
    const handleViewOnWikistr = () => {
      if (!dTag) return
      closeDrawer()
      window.open(`https://wikistr.imwald.eu/${dTag}*${event.pubkey}`, '_blank', 'noopener,noreferrer')
    }

    const handleViewOnAlexandria = () => {
      if (!naddr) return
      closeDrawer()
      window.open(`https://next-alexandria.gitcitadel.eu/publication/naddr/${naddr}`, '_blank', 'noopener,noreferrer')
    }

    const handleViewOnDecentNewsroom = () => {
      if (!dTag) return
      closeDrawer()
      window.open(`https://decentnewsroom.com/article/d/${dTag}`, '_blank', 'noopener,noreferrer')
    }
    const actions: MenuAction[] = [
      {
        icon: Copy,
        label: t('Copy event ID'),
        onClick: () => {
          navigator.clipboard.writeText(getNoteBech32Id(event))
          closeDrawer()
        }
      },
      {
        icon: Copy,
        label: t('Copy user ID'),
        onClick: () => {
          navigator.clipboard.writeText(pubkeyToNpub(event.pubkey) ?? '')
          closeDrawer()
        }
      },
      {
        icon: Link,
        label: t('Share with Jumble'),
        onClick: () => {
          const noteId = getNoteBech32Id(event)
          // Only include context for discussions page, use plain /notes/{id} for others
          const path = currentPrimaryPage === 'discussions'
            ? `/discussions/notes/${noteId}`
            : `/notes/${noteId}`
          const jumbleUrl = `https://jumble.imwald.eu${path}`
          navigator.clipboard.writeText(jumbleUrl)
          closeDrawer()
        }
      },
      {
        icon: BookOpen,
        label: t('Share with Alexandria'),
        onClick: () => {
          navigator.clipboard.writeText(toAlexandria(getNoteBech32Id(event)))
          closeDrawer()
        }
      }
    ]

    // Add "View on Alexandria" menu item for public messages (PMs)
    if (event.kind === ExtendedKind.PUBLIC_MESSAGE) {
      actions.push({
        icon: Globe,
        label: t('View on Alexandria'),
        onClick: () => {
          closeDrawer()
          window.open('https://next-alexandria.gitcitadel.eu/profile/notifications', '_blank', 'noopener,noreferrer')
        },
        separator: true
      })
    }

    // Add "Create Highlight" action for OP events
    if (isOPEvent && openHighlightEditor) {
      actions.push({
        icon: Highlighter,
        label: t('Create Highlight'),
        onClick: () => {
          try {
            // Get selected text and paragraph context
            const selection = window.getSelection()
            let selectedText = ''
            let paragraphContext = ''
            
            if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
              const range = selection.getRangeAt(0)
              
              // Helper function to check if an element is a UI element that should be excluded
              const isUIElement = (element: Element | null): boolean => {
                if (!element) return false
                
                const tagName = element.tagName?.toLowerCase()
                const className = element.className || ''
                const id = element.id || ''
                
                // Exclude common UI elements
                const uiTags = ['nav', 'header', 'footer', 'aside', 'button', 'menu', 'dialog', 'form', 'input', 'select', 'textarea']
                if (uiTags.includes(tagName)) return true
                
                // Exclude elements with UI-related classes
                const uiClassPatterns = [
                  /sidebar/i,
                  /navbar/i,
                  /menu/i,
                  /header/i,
                  /footer/i,
                  /titlebar/i,
                  /button/i,
                  /dialog/i,
                  /modal/i,
                  /drawer/i,
                  /toolbar/i,
                  /action/i,
                  /control/i
                ]
                if (uiClassPatterns.some(pattern => pattern.test(className) || pattern.test(id))) return true
                
                // Exclude elements with role attributes that indicate UI
                const role = element.getAttribute('role')
                if (role && ['navigation', 'banner', 'contentinfo', 'complementary', 'dialog', 'button', 'menubar', 'menu'].includes(role)) {
                  return true
                }
                
                return false
              }
              
              // Find the article content container (element with 'prose' class)
              // This is where the actual article content is rendered
              let articleContainer: Element | null = null
              let container: Node | null = range.commonAncestorContainer
              
              // Walk up the DOM tree to find the article container
              while (container && container.nodeType !== Node.ELEMENT_NODE) {
                container = container.parentNode
              }
              
              if (container) {
                let current: Element | null = container as Element
                while (current) {
                  // Check if this element is the article content container
                  const className = current.className || ''
                  if (typeof className === 'string' && className.includes('prose')) {
                    articleContainer = current
                    break
                  }
                  // Also check parent elements
                  current = current.parentElement
                }
              }
              
              // If we couldn't find the article container, try to find it by looking for the event's note container
              if (!articleContainer) {
                // Try to find the note container by searching for elements that might contain the event
                const allElements = document.querySelectorAll('[data-event-id], [data-note-id], .note-content, article')
                for (const el of allElements) {
                  if (el.contains(range.startContainer) && el.contains(range.endContainer)) {
                    // Check if this element has prose class or contains prose elements
                    const hasProse = el.classList.contains('prose') || el.querySelector('.prose')
                    if (hasProse) {
                      articleContainer = el.querySelector('.prose') || el
                      break
                    }
                  }
                }
              }
              
              // Verify that the selection is within the article content and not in UI elements
              let startElement: Element | null = null
              let endElement: Element | null = null
              
              if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
                startElement = range.startContainer as Element
              } else {
                startElement = range.startContainer.parentElement
              }
              
              if (range.endContainer.nodeType === Node.ELEMENT_NODE) {
                endElement = range.endContainer as Element
              } else {
                endElement = range.endContainer.parentElement
              }
              
              // Check if selection includes UI elements
              let current: Element | null = startElement
              let hasUIElements = false
              while (current && current !== articleContainer?.parentElement) {
                if (isUIElement(current)) {
                  hasUIElements = true
                  break
                }
                current = current.parentElement
              }
              
              if (!hasUIElements && endElement) {
                current = endElement
                while (current && current !== articleContainer?.parentElement) {
                  if (isUIElement(current)) {
                    hasUIElements = true
                    break
                  }
                  current = current.parentElement
                }
              }
              
              // If selection includes UI elements, show error
              if (hasUIElements) {
                toast.error(t('Please select text only from the article content, not from menus or UI elements'))
                return
              }
              
              // If we found an article container, verify selection is within it
              if (articleContainer && !articleContainer.contains(range.startContainer)) {
                toast.error(t('Please select text only from the article content, not from menus or UI elements'))
                return
              }
              
              // Create a new range that only includes content from the article
              const contentRange = range.cloneRange()
              
              // If we have an article container, try to constrain the range to it
              // This helps ensure we only capture article content, not UI elements
              if (articleContainer) {
                try {
                  // Verify both start and end are within article container
                  const rangeStart = range.startContainer
                  const rangeEnd = range.endContainer
                  
                  // If start is not in article container, try to adjust it
                  if (!articleContainer.contains(rangeStart)) {
                    // This shouldn't happen if our check above worked, but handle it anyway
                    logger.warn('Selection start is outside article container', { 
                      hasArticleContainer: !!articleContainer 
                    })
                    // Try to find the first text node in the article container
                    const walker = document.createTreeWalker(
                      articleContainer,
                      NodeFilter.SHOW_TEXT,
                      null
                    )
                    let node = walker.nextNode()
                    if (node) {
                      contentRange.setStart(node, 0)
                    } else {
                      // No text nodes in article container, reject selection
                      toast.error(t('Please select text from the article content'))
                      return
                    }
                  }
                  
                  // If end is not in article container, try to adjust it
                  if (!articleContainer.contains(rangeEnd)) {
                    logger.warn('Selection end is outside article container', { 
                      hasArticleContainer: !!articleContainer 
                    })
                    // Try to find the last text node in the article container
                    const walker = document.createTreeWalker(
                      articleContainer,
                      NodeFilter.SHOW_TEXT,
                      null
                    )
                    let lastNode: Node | null = null
                    let node = walker.nextNode()
                    while (node) {
                      lastNode = node
                      node = walker.nextNode()
                    }
                    if (lastNode && lastNode.textContent) {
                      contentRange.setEnd(lastNode, lastNode.textContent.length)
                    }
                  }
                } catch (e) {
                  // If range manipulation fails, log and continue with original range
                  // But we've already validated it's not in UI elements
                  logger.warn('Failed to constrain range to article container', { error: e })
                }
              }
              
              // Get the selected text from the constrained range
              selectedText = contentRange.toString().trim()
              
              // Filter out common UI text patterns that might have been captured
              const uiTextPatterns = [
                /^(Home|Explore|Discussions|Notifications|Search|Profile|Settings|Post|Back|Follow|Following|Relays|Posts|Articles|Media|Pins|Bookmarks|Interests|All Types|Translate)$/i,
                /^(@|#|wss?:\/\/)/, // Usernames, hashtags, relay URLs at start
                /^(npub1|note1|nevent1|naddr1)/i // Nostr identifiers at start
              ]
              
              // Check if selected text looks like UI text
              if (uiTextPatterns.some(pattern => pattern.test(selectedText))) {
                toast.error(t('Please select text from the article content, not from UI elements'))
                return
              }
              
              // Find the actual paragraph element (<p> tag) containing the selection
              // We want the specific paragraph, not a parent container
              let container2: Node | null = contentRange.commonAncestorContainer
              
              // Walk up the DOM tree to find a paragraph element
              while (container2 && container2.nodeType !== Node.ELEMENT_NODE) {
                container2 = container2.parentNode
              }
              
              let paragraphElement: Element | null = null
              if (container2) {
                let current: Element | null = container2 as Element
                // First pass: look specifically for a <p> tag or header
                while (current) {
                  // Skip UI elements
                  if (isUIElement(current)) {
                    current = current.parentElement
                    continue
                  }
                  
                  const tagName = current.tagName?.toLowerCase()
                  // Prioritize finding actual paragraph tags or headers
                  if (tagName === 'p' || (tagName?.startsWith('h') && /^h[1-6]$/.test(tagName))) {
                    // Found a paragraph or header tag - this is what we want
                    if (current.contains(contentRange.startContainer) && current.contains(contentRange.endContainer)) {
                      paragraphElement = current
                      break
                    }
                  }
                  current = current.parentElement
                }
                
                // If we didn't find a <p> or header tag, try to find the closest text-containing element
                // but only as a last resort, and make sure it's not a large container
                if (!paragraphElement && container2) {
                  current = container2 as Element
                  while (current) {
                    if (isUIElement(current)) {
                      current = current.parentElement
                      continue
                    }
                    
                    const tagName = current.tagName?.toLowerCase()
                    // Only use div/article/section if it's small and doesn't have many paragraph children
                    if ((tagName === 'div' || tagName === 'article' || tagName === 'section') &&
                        current.contains(contentRange.startContainer) && current.contains(contentRange.endContainer)) {
                      // Make sure it's within the article container
                      if (!articleContainer || articleContainer.contains(current)) {
                        // Count how many paragraph children it has
                        const paragraphChildren = Array.from(current.children).filter(
                          child => {
                            const childTag = child.tagName?.toLowerCase()
                            return (childTag === 'p' || childTag?.startsWith('h')) && !isUIElement(child)
                          }
                        )
                        
                        // Only use this as paragraph element if it has very few paragraph children (1-2)
                        // This prevents using large containers that hold the entire article
                        if (paragraphChildren.length <= 2) {
                          paragraphElement = current
                          break
                        }
                      }
                    }
                    current = current.parentElement
                  }
                }
              }
              
              // If we found a paragraph element, get its text content and the paragraph above/below it
              // But filter out any UI elements from the paragraph context
              if (paragraphElement) {
                const tagName = paragraphElement.tagName?.toLowerCase()
                const isHeader = tagName?.startsWith('h') && /^h[1-6]$/.test(tagName)
                
                // Get text content of current element (paragraph or header), but exclude UI elements
                const walker = document.createTreeWalker(
                  paragraphElement,
                  NodeFilter.SHOW_TEXT,
                  {
                    acceptNode: (node) => {
                      // Check if the text node's parent is a UI element
                      let parent = node.parentElement
                      while (parent && parent !== paragraphElement) {
                        if (isUIElement(parent)) {
                          return NodeFilter.FILTER_REJECT
                        }
                        parent = parent.parentElement
                      }
                      return NodeFilter.FILTER_ACCEPT
                    }
                  }
                )
                
                const textNodes: string[] = []
                let node = walker.nextNode()
                while (node) {
                  if (node.textContent) {
                    textNodes.push(node.textContent)
                  }
                  node = walker.nextNode()
                }
                const currentElementText = textNodes.join('').trim()
                
                // For headers, get the following paragraph. For paragraphs, get the one above.
                let contextParagraphText = ''
                
                if (articleContainer) {
                  // Get all content elements (p, h1-h6) within the article container, in DOM order
                  const allElements = Array.from(articleContainer.querySelectorAll('p, h1, h2, h3, h4, h5, h6'))
                    .filter(el => {
                      // Filter out UI elements
                      if (isUIElement(el)) return false
                      // Only include elements that are within the article container
                      return articleContainer.contains(el)
                    })
                  
                  // Find the index of the current element
                  const currentIndex = allElements.indexOf(paragraphElement)
                  
                  if (isHeader) {
                    // For headers: get the next paragraph after the header
                    if (currentIndex >= 0 && currentIndex < allElements.length - 1) {
                      // Look for the next paragraph (not header) after this header
                      for (let i = currentIndex + 1; i < allElements.length; i++) {
                        const nextElement = allElements[i]
                        const nextTagName = nextElement.tagName?.toLowerCase()
                        if (nextTagName === 'p' && !isUIElement(nextElement)) {
                          // Found the next paragraph
                          const nextWalker = document.createTreeWalker(
                            nextElement,
                            NodeFilter.SHOW_TEXT,
                            {
                              acceptNode: (node) => {
                                let parent = node.parentElement
                                while (parent && parent !== nextElement) {
                                  if (isUIElement(parent)) {
                                    return NodeFilter.FILTER_REJECT
                                  }
                                  parent = parent.parentElement
                                }
                                return NodeFilter.FILTER_ACCEPT
                              }
                            }
                          )
                          
                          const nextTextNodes: string[] = []
                          let nextNode = nextWalker.nextNode()
                          while (nextNode) {
                            if (nextNode.textContent) {
                              nextTextNodes.push(nextNode.textContent)
                            }
                            nextNode = nextWalker.nextNode()
                          }
                          contextParagraphText = nextTextNodes.join('').trim()
                          break
                        }
                        // If we hit another header before a paragraph, stop looking
                        if (nextTagName?.startsWith('h')) {
                          break
                        }
                      }
                    }
                  } else {
                    // For paragraphs: get the previous paragraph or header
                    if (currentIndex > 0) {
                      const previousElement = allElements[currentIndex - 1]
                      if (previousElement && !isUIElement(previousElement)) {
                        // Get text from previous element, excluding UI elements
                        const prevWalker = document.createTreeWalker(
                          previousElement,
                          NodeFilter.SHOW_TEXT,
                          {
                            acceptNode: (node) => {
                              let parent = node.parentElement
                              while (parent && parent !== previousElement) {
                                if (isUIElement(parent)) {
                                  return NodeFilter.FILTER_REJECT
                                }
                                parent = parent.parentElement
                              }
                              return NodeFilter.FILTER_ACCEPT
                            }
                          }
                        )
                        
                        const prevTextNodes: string[] = []
                        let prevNode = prevWalker.nextNode()
                        while (prevNode) {
                          if (prevNode.textContent) {
                            prevTextNodes.push(prevNode.textContent)
                          }
                          prevNode = prevWalker.nextNode()
                        }
                        contextParagraphText = prevTextNodes.join('').trim()
                      }
                    }
                  }
                } else {
                  // Fallback: if no article container, use sibling elements
                  if (isHeader) {
                    // For headers: find next sibling paragraph
                    let nextSibling = paragraphElement.nextElementSibling
                    while (nextSibling) {
                      if (isUIElement(nextSibling)) {
                        nextSibling = nextSibling.nextElementSibling
                        continue
                      }
                      const nextTagName = nextSibling.tagName?.toLowerCase()
                      if (nextTagName === 'p') {
                        const nextText = nextSibling.textContent?.trim() || ''
                        if (nextText) {
                          contextParagraphText = nextText
                        }
                        break
                      }
                      // Stop if we hit another header
                      if (nextTagName?.startsWith('h')) {
                        break
                      }
                      nextSibling = nextSibling.nextElementSibling
                    }
                  } else {
                    // For paragraphs: find previous sibling
                    let prevSibling = paragraphElement.previousElementSibling
                    while (prevSibling) {
                      if (isUIElement(prevSibling)) {
                        prevSibling = prevSibling.previousElementSibling
                        continue
                      }
                      const prevTagName = prevSibling.tagName?.toLowerCase()
                      if (prevTagName === 'p' || prevTagName?.startsWith('h')) {
                        const prevText = prevSibling.textContent?.trim() || ''
                        if (prevText) {
                          contextParagraphText = prevText
                        }
                        break
                      }
                      prevSibling = prevSibling.previousElementSibling
                    }
                  }
                }
                
                // Combine context paragraph and current element
                if (contextParagraphText) {
                  if (isHeader) {
                    // Header followed by paragraph
                    paragraphContext = `${currentElementText}\n\n${contextParagraphText}`
                  } else {
                    // Previous paragraph/header followed by current paragraph
                    paragraphContext = `${contextParagraphText}\n\n${currentElementText}`
                  }
                } else {
                  // Just the current element
                  paragraphContext = currentElementText
                }
              } else {
                // Fallback: if we couldn't find a paragraph element, just use the selected text
                // Don't try to expand too much - just use what was selected
                paragraphContext = selectedText
              }
            }
            
            // Final validation: ensure we have valid selected text
            if (!selectedText || selectedText.length === 0) {
              toast.error(t('Please select some text from the article to highlight'))
              return
            }
            
            // For addressable events (publications, long-form articles with d-tag), use naddr
            // For regular events, use nevent
            let sourceValue: string
            let sourceHexId: string | undefined
            
            if (kinds.isAddressableKind(event.kind) || kinds.isReplaceableKind(event.kind)) {
              // Generate naddr for addressable/replaceable events
              const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || ''
              if (dTag) {
                const relays = event.tags
                  .filter(tag => tag[0] === 'relay')
                  .map(tag => tag[1])
                  .filter(Boolean)
                
                try {
                  sourceValue = nip19.naddrEncode({
                    kind: event.kind,
                    pubkey: event.pubkey,
                    identifier: dTag,
                    relays: relays.length > 0 ? relays : undefined
                  })
                  sourceHexId = undefined // naddr doesn't have a single hex ID
                } catch (error) {
                  logger.error('Error generating naddr for highlight', { error })
                  // Fallback to nevent
                  sourceValue = getNoteBech32Id(event)
                  sourceHexId = event.id
                }
              } else {
                // No d-tag, use nevent
                sourceValue = getNoteBech32Id(event)
                sourceHexId = event.id
              }
            } else {
              // Regular event, use nevent
              sourceValue = getNoteBech32Id(event)
              sourceHexId = event.id
            }
            
            const highlightData: import('../PostEditor/HighlightEditor').HighlightData = {
              sourceType: 'nostr',
              sourceValue,
              sourceHexId,
              context: paragraphContext || undefined
            }
            
            // Use selected text as content if available, otherwise use event content
            const content = selectedText || event.content
            openHighlightEditor(highlightData, content)
          } catch (error) {
            logger.error('Error creating highlight from event', { error, eventId: event.id })
            toast.error(t('Failed to create highlight'))
          }
        },
        separator: true
      })
    }

    actions.push({
      icon: Code,
      label: t('View raw event'),
      onClick: () => {
        closeDrawer()
        setIsRawEventDialogOpen(true)
      },
      separator: true
    })

    // Add export options for article-type events
    if (isArticleType) {
      const isMarkdownFormat = event.kind === kinds.LongFormArticle || event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN
      const isAsciidocFormat = event.kind === ExtendedKind.WIKI_ARTICLE || event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT
      
      if (isMarkdownFormat) {
        actions.push({
          icon: FileDown,
          label: t('Export as Markdown'),
          onClick: () => {
            closeDrawer()
            exportAsMarkdown()
          },
          separator: true
        })
      }
      
      if (isAsciidocFormat) {
        actions.push({
          icon: FileDown,
          label: t('Export as AsciiDoc'),
          onClick: () => {
            closeDrawer()
            exportAsAsciidoc()
          },
          separator: true
        })
      }

      // Add view options based on event kind
      if (event.kind === kinds.LongFormArticle) {
        // For LongFormArticle (30023): Alexandria and DecentNewsroom
        if (naddr) {
          actions.push({
            icon: BookOpen,
            label: t('View on Alexandria'),
            onClick: handleViewOnAlexandria
          })
        }
        if (dTag) {
          actions.push({
            icon: Globe,
            label: t('View on DecentNewsroom'),
            onClick: handleViewOnDecentNewsroom
          })
        }
      } else if (
        event.kind === ExtendedKind.PUBLICATION_CONTENT ||
        event.kind === ExtendedKind.PUBLICATION ||
        event.kind === ExtendedKind.WIKI_ARTICLE ||
        event.kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN
      ) {
        // For 30041, 30040, 30818, 30817: Alexandria and Wikistr
        if (naddr) {
          actions.push({
            icon: BookOpen,
            label: t('View on Alexandria'),
            onClick: handleViewOnAlexandria
          })
        }
        if (dTag) {
          actions.push({
            icon: Globe,
            label: t('View on Wikistr'),
            onClick: handleViewOnWikistr
          })
        }
      }
    }

    const isProtected = isProtectedEvent(event)
    const isDiscussion = event.kind === ExtendedKind.DISCUSSION
    if ((!isProtected || event.pubkey === pubkey) && !isDiscussion && !isReplyToDiscussion) {
      actions.push({
        icon: SatelliteDish,
        label: t('Republish to ...'),
        onClick: isSmallScreen
          ? () => showSubMenuActions(broadcastSubMenu, t('Republish to ...'))
          : undefined,
        subMenu: isSmallScreen ? undefined : broadcastSubMenu,
        separator: true
      })
    }

    if (pubkey && event.pubkey !== pubkey) {
      actions.push({
        icon: TriangleAlert,
        label: t('Report'),
        className: 'text-destructive focus:text-destructive',
        onClick: () => {
          closeDrawer()
          setIsReportDialogOpen(true)
        },
        separator: true
      })
    }

    if (pubkey && event.pubkey !== pubkey) {
      if (isMuted) {
        actions.push({
          icon: Bell,
          label: t('Unmute user'),
          onClick: () => {
            closeDrawer()
            unmutePubkey(event.pubkey)
          },
          className: 'text-destructive focus:text-destructive',
          separator: true
        })
      } else {
        actions.push(
          {
            icon: BellOff,
            label: t('Mute user privately'),
            onClick: () => {
              closeDrawer()
              mutePubkeyPrivately(event.pubkey)
            },
            className: 'text-destructive focus:text-destructive',
            separator: true
          },
          {
            icon: BellOff,
            label: t('Mute user publicly'),
            onClick: () => {
              closeDrawer()
              mutePubkeyPublicly(event.pubkey)
            },
            className: 'text-destructive focus:text-destructive'
          }
        )
      }
    }

    // Pin functionality available for any note (not just own notes)
    if (pubkey) {
      actions.push({
        icon: Pin,
        label: isPinned ? t('Unpin note') : t('Pin note'),
        onClick: () => {
          handlePinNote()
        },
        separator: true
      })
    }

    // Delete functionality only available for own notes
    if (pubkey && event.pubkey === pubkey) {
      actions.push({
        icon: Trash2,
        label: t('Try deleting this note'),
        onClick: () => {
          closeDrawer()
          attemptDelete(event)
        },
        className: 'text-destructive focus:text-destructive'
      })
    }

    return actions
  }, [
    t,
    event,
    pubkey,
    isMuted,
    isSmallScreen,
    openHighlightEditor,
    broadcastSubMenu,
    closeDrawer,
    showSubMenuActions,
    setIsRawEventDialogOpen,
    setIsReportDialogOpen,
    mutePubkeyPrivately,
    mutePubkeyPublicly,
    unmutePubkey,
    attemptDelete,
    isPinned,
    handlePinNote,
    isArticleType,
    articleMetadata,
    dTag,
    naddr
  ])

  return menuActions
}
