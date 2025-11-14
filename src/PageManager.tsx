import Sidebar from '@/components/Sidebar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import logger from '@/lib/logger'
import { ChevronLeft } from 'lucide-react'
import { NavigationService } from '@/services/navigation.service'
import NoteListPage from '@/pages/primary/NoteListPage'
import SecondaryNoteListPage from '@/pages/secondary/NoteListPage'
// Page imports needed for primary note view
import SettingsPage from '@/pages/secondary/SettingsPage'
import RelaySettingsPage from '@/pages/secondary/RelaySettingsPage'
import WalletPage from '@/pages/secondary/WalletPage'
import PostSettingsPage from '@/pages/secondary/PostSettingsPage'
import GeneralSettingsPage from '@/pages/secondary/GeneralSettingsPage'
import TranslationPage from '@/pages/secondary/TranslationPage'
import RssFeedSettingsPage from '@/pages/secondary/RssFeedSettingsPage'
import NotePage from '@/pages/secondary/NotePage'
import SecondaryProfilePage from '@/pages/secondary/ProfilePage'
import FollowingListPage from '@/pages/secondary/FollowingListPage'
import MuteListPage from '@/pages/secondary/MuteListPage'
import OthersRelaySettingsPage from '@/pages/secondary/OthersRelaySettingsPage'
import SecondaryRelayPage from '@/pages/secondary/RelayPage'
import { CurrentRelaysProvider } from '@/providers/CurrentRelaysProvider'
import { NotificationProvider } from '@/providers/NotificationProvider'
// DEPRECATED: useUserPreferences removed - double-panel functionality disabled
import { TPageRef } from '@/types'
import {
  cloneElement,
  createContext,
  createRef,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import BottomNavigationBar from './components/BottomNavigationBar'
import TooManyRelaysAlertDialog from './components/TooManyRelaysAlertDialog'
import { normalizeUrl } from './lib/url'
import ExplorePage from './pages/primary/ExplorePage'
import MePage from './pages/primary/MePage'
import NotificationListPage from './pages/primary/NotificationListPage'
import ProfilePage from './pages/primary/ProfilePage'
import RelayPage from './pages/primary/RelayPage'
import SearchPage from './pages/primary/SearchPage'
import DiscussionsPage from './pages/primary/DiscussionsPage'
import { useScreenSize } from './providers/ScreenSizeProvider'
import { routes } from './routes'
import modalManager from './services/modal-manager.service'
import CreateWalletGuideToast from './components/CreateWalletGuideToast'

export type TPrimaryPageName = keyof typeof PRIMARY_PAGE_MAP

type TPrimaryPageContext = {
  navigate: (page: TPrimaryPageName, props?: object) => void
  current: TPrimaryPageName | null
  display: boolean
}

type TSecondaryPageContext = {
  push: (url: string) => void
  pop: () => void
  currentIndex: number
}

type TStackItem = {
  index: number
  url: string
  component: React.ReactElement | null
  ref: RefObject<TPageRef> | null
}

const PRIMARY_PAGE_REF_MAP = {
  home: createRef<TPageRef>(),
  explore: createRef<TPageRef>(),
  notifications: createRef<TPageRef>(),
  me: createRef<TPageRef>(),
  profile: createRef<TPageRef>(),
  relay: createRef<TPageRef>(),
  search: createRef<TPageRef>(),
  discussions: createRef<TPageRef>()
}

const PRIMARY_PAGE_MAP = {
  home: <NoteListPage ref={PRIMARY_PAGE_REF_MAP.home} />,
  explore: <ExplorePage ref={PRIMARY_PAGE_REF_MAP.explore} />,
  notifications: <NotificationListPage ref={PRIMARY_PAGE_REF_MAP.notifications} />,
  me: <MePage ref={PRIMARY_PAGE_REF_MAP.me} />,
  profile: <ProfilePage ref={PRIMARY_PAGE_REF_MAP.profile} />,
  relay: <RelayPage ref={PRIMARY_PAGE_REF_MAP.relay} />,
  search: <SearchPage ref={PRIMARY_PAGE_REF_MAP.search} />,
  discussions: <DiscussionsPage ref={PRIMARY_PAGE_REF_MAP.discussions} />
}

const PrimaryPageContext = createContext<TPrimaryPageContext | undefined>(undefined)

const SecondaryPageContext = createContext<TSecondaryPageContext | undefined>(undefined)

const PrimaryNoteViewContext = createContext<{
  setPrimaryNoteView: (view: ReactNode | null, type?: 'note' | 'settings' | 'settings-sub' | 'profile' | 'hashtag' | 'relay' | 'following' | 'mute' | 'others-relay-settings') => void
  primaryViewType: 'note' | 'settings' | 'settings-sub' | 'profile' | 'hashtag' | 'relay' | 'following' | 'mute' | 'others-relay-settings' | null
  getNavigationCounter: () => number
} | undefined>(undefined)

export function usePrimaryPage() {
  const context = useContext(PrimaryPageContext)
  if (!context) {
    throw new Error('usePrimaryPage must be used within a PrimaryPageContext.Provider')
  }
  return context
}

export function useSecondaryPage() {
  const context = useContext(SecondaryPageContext)
  if (!context) {
    throw new Error('usePrimaryPage must be used within a SecondaryPageContext.Provider')
  }
  return context
}

export function usePrimaryNoteView() {
  const context = useContext(PrimaryNoteViewContext)
  if (!context) {
    throw new Error('usePrimaryNoteView must be used within a PrimaryNoteViewContext.Provider')
  }
  return context
}

// Fixed: Note navigation now uses primary note view on mobile, secondary routing on desktop
export function useSmartNoteNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  
  const navigateToNote = (url: string) => {
    // Event ID will be saved when setPrimaryNoteView or pushSecondaryPage is called
    
    if (isSmallScreen) {
      // Use primary note view on mobile
      const noteId = url.replace('/notes/', '')
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<NotePage id={noteId} index={0} hideTitlebar={true} />, 'note')
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToNote }
}

// Fixed: Relay navigation now uses primary note view on mobile, secondary routing on desktop
export function useSmartRelayNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  
  const navigateToRelay = (url: string) => {
    if (isSmallScreen) {
      // Use primary note view on mobile
      const relayUrl = decodeURIComponent(url.replace('/relays/', ''))
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<SecondaryRelayPage url={relayUrl} index={0} hideTitlebar={true} />, 'relay')
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToRelay }
}

// Fixed: Profile navigation now uses primary note view on mobile, secondary routing on desktop
export function useSmartProfileNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  
  const navigateToProfile = (url: string) => {
    if (isSmallScreen) {
      // Use primary note view on mobile
      const profileId = url.replace('/users/', '')
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<SecondaryProfilePage id={profileId} index={0} hideTitlebar={true} />, 'profile')
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToProfile }
}

// Fixed: Hashtag navigation now uses primary note view since secondary panel is disabled
export function useSmartHashtagNavigation() {
  const { setPrimaryNoteView, getNavigationCounter } = usePrimaryNoteView()
  
  const navigateToHashtag = (url: string) => {
    // Use primary note view to show hashtag feed since secondary panel is disabled
    // Update URL first - do this synchronously before setting the view
    const parsedUrl = url.startsWith('/') ? url : `/${url}`
    window.history.pushState(null, '', parsedUrl)
    
    // Extract hashtag from URL for the key to ensure unique keys for different hashtags
    const searchParams = new URLSearchParams(parsedUrl.includes('?') ? parsedUrl.split('?')[1] : '')
    const hashtag = searchParams.get('t') || ''
    // Get the current navigation counter and use next value for the key
    // This ensures unique keys that force remounting - setPrimaryNoteView will increment it
    const counter = getNavigationCounter()
    const key = `hashtag-${hashtag}-${counter + 1}`
    
    // Use a key based on the hashtag and navigation counter to force remounting when hashtag changes
    // This ensures the component reads the new URL parameters when it mounts
    // setPrimaryNoteView will increment the counter, so we use counter + 1 for the key
    setPrimaryNoteView(<SecondaryNoteListPage key={key} hideTitlebar={true} />, 'hashtag')
    // Dispatch custom event as a fallback for components that might be reused
    window.dispatchEvent(new CustomEvent('hashtag-navigation', { detail: { url: parsedUrl } }))
  }
  
  return { navigateToHashtag }
}

// Fixed: Following list navigation now uses primary note view on mobile, secondary routing on desktop
export function useSmartFollowingListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  
  const navigateToFollowingList = (url: string) => {
    if (isSmallScreen) {
      // Use primary note view on mobile
      const profileId = url.replace('/users/', '').replace('/following', '')
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<FollowingListPage id={profileId} index={0} hideTitlebar={true} />, 'following')
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToFollowingList }
}

// Fixed: Mute list navigation now uses primary note view on mobile, secondary routing on desktop
export function useSmartMuteListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  
  const navigateToMuteList = (url: string) => {
    if (isSmallScreen) {
      // Use primary note view on mobile
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<MuteListPage index={0} hideTitlebar={true} />, 'mute')
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToMuteList }
}

// Fixed: Others relay settings navigation now uses primary note view on mobile, secondary routing on desktop
export function useSmartOthersRelaySettingsNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  
  const navigateToOthersRelaySettings = (url: string) => {
    if (isSmallScreen) {
      // Use primary note view on mobile
      const profileId = url.replace('/users/', '').replace('/relays', '')
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<OthersRelaySettingsPage id={profileId} index={0} hideTitlebar={true} />, 'others-relay-settings')
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToOthersRelaySettings }
}

// Fixed: Settings navigation now uses primary note view since secondary panel is disabled
export function useSmartSettingsNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  
  const navigateToSettings = (url: string) => {
    // Use primary note view to show settings since secondary panel is disabled
    if (url === '/settings') {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<SettingsPage key="settings" index={0} hideTitlebar={true} />, 'settings')
    } else if (url.startsWith('/settings/relays')) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<RelaySettingsPage key="relay-settings" index={0} hideTitlebar={true} />, 'settings-sub')
    } else if (url === '/settings/wallet') {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<WalletPage key="wallet" index={0} hideTitlebar={true} />, 'settings-sub')
    } else if (url === '/settings/posts') {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<PostSettingsPage key="post-settings" index={0} hideTitlebar={true} />, 'settings-sub')
    } else if (url === '/settings/general') {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<GeneralSettingsPage key="general-settings" index={0} hideTitlebar={true} />, 'settings-sub')
    } else if (url === '/settings/translation') {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<TranslationPage key="translation" index={0} hideTitlebar={true} />, 'settings-sub')
    } else if (url === '/settings/rss-feeds') {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(<RssFeedSettingsPage key="rss-feed-settings" index={0} hideTitlebar={true} />, 'settings-sub')
    }
  }
  
  return { navigateToSettings }
}

// DEPRECATED: ConditionalHomePage removed - double-panel functionality disabled

// Helper function to get page title based on view type and URL
function getPageTitle(viewType: 'note' | 'settings' | 'settings-sub' | 'profile' | 'hashtag' | 'relay' | 'following' | 'mute' | 'others-relay-settings' | null, pathname: string): string {
  // Create a temporary navigation service instance to use the getPageTitle method
  const tempService = new NavigationService({ setPrimaryNoteView: () => {} })
  return tempService.getPageTitle(viewType, pathname)
}

// DEPRECATED: Double-panel functionality removed - simplified to single column layout
function MainContentArea({ 
  primaryPages, 
  currentPrimaryPage, 
  primaryNoteView,
  primaryViewType,
  goBack
}: {
  primaryPages: { name: TPrimaryPageName; element: ReactNode; props?: any }[]
  currentPrimaryPage: TPrimaryPageName
  primaryNoteView: ReactNode | null
  primaryViewType: 'note' | 'settings' | 'settings-sub' | 'profile' | 'hashtag' | 'relay' | 'following' | 'mute' | 'others-relay-settings' | null
  goBack: () => void
}) {
  const [, forceUpdate] = useState(0)
  
  // Listen for note page title updates
  useEffect(() => {
    const handleTitleUpdate = () => {
      forceUpdate(n => n + 1)
    }
    window.addEventListener('notePageTitleUpdated', handleTitleUpdate)
    return () => {
      window.removeEventListener('notePageTitleUpdated', handleTitleUpdate)
    }
  }, [])
  
  logger.debug('MainContentArea rendering:', { 
    currentPrimaryPage, 
    primaryPages: primaryPages.map(p => p.name), 
    primaryNoteView: !!primaryNoteView
  })
  
  // Always use single column layout since double-panel is disabled
  return (
    <div className="grid grid-cols-1 gap-2 w-full pr-2 py-2">
      <div className="rounded-lg shadow-lg bg-background overflow-hidden">
        {primaryNoteView ? (
          // Show note view with back button
          <div className="flex flex-col h-full w-full">
            <div className="flex justify-center py-1 border-b">
              <span className="text-green-600 dark:text-green-500 font-semibold text-sm">
                Imwald
              </span>
            </div>
            <div className="flex gap-1 p-1 items-center justify-between font-semibold border-b">
              <div className="flex items-center flex-1 w-0">
                <Button
                  className="flex gap-1 items-center w-fit max-w-full justify-start pl-2 pr-3"
                  variant="ghost"
                  size="titlebar-icon"
                  title="Back"
                  onClick={goBack}
                >
                  <ChevronLeft />
                  <div className="truncate text-lg font-semibold">
                    Back
                  </div>
                </Button>
              </div>
              <div className="flex-1 flex justify-center">
                <div className="text-lg font-semibold">
                  {getPageTitle(primaryViewType, window.location.pathname)}
                </div>
              </div>
              <div className="flex-1 w-0"></div>
            </div>
            <div className="flex-1 overflow-auto">
              {primaryNoteView}
            </div>
          </div>
        ) : (
          // Show normal primary pages
          primaryPages.map(({ name, element, props }) => {
            const isCurrentPage = currentPrimaryPage === name
            logger.debug(`Primary page ${name}:`, { isCurrentPage, currentPrimaryPage })
            return (
              <div
                key={name}
                className="flex flex-col h-full w-full"
                style={{
                  display: isCurrentPage ? 'block' : 'none'
                }}
              >
                {(() => {
                  try {
                    logger.debug(`Rendering ${name} component`)
                    return props ? cloneElement(element as React.ReactElement, props) : element
                  } catch (error) {
                    logger.error(`Error rendering ${name} component:`, error)
                    return <div>Error rendering {name}: {error instanceof Error ? error.message : String(error)}</div>
                  }
                })()}
              </div>
            )
          })
        )}
      </div>
      {/* DEPRECATED: Secondary panel removed - double-panel functionality disabled */}
    </div>
  )
}

export function PageManager({ maxStackSize = 5 }: { maxStackSize?: number }) {
  const { isSmallScreen } = useScreenSize()
  // DEPRECATED: showRecommendedRelaysPanel removed - double-panel functionality disabled
  const [currentPrimaryPage, setCurrentPrimaryPage] = useState<TPrimaryPageName>('home')
  const [primaryPages, setPrimaryPages] = useState<
    { name: TPrimaryPageName; element: ReactNode; props?: any }[]
  >([
    {
      name: 'home',
      element: PRIMARY_PAGE_MAP.home
    }
  ])
  const [secondaryStack, setSecondaryStack] = useState<TStackItem[]>([])
  const [primaryNoteView, setPrimaryNoteViewState] = useState<ReactNode | null>(null)
  const [primaryViewType, setPrimaryViewType] = useState<'note' | 'settings' | 'settings-sub' | 'profile' | 'hashtag' | 'relay' | 'following' | 'mute' | 'others-relay-settings' | null>(null)
  const [savedPrimaryPage, setSavedPrimaryPage] = useState<TPrimaryPageName | null>(null)
  const navigationCounterRef = useRef(0)
  const savedEventIdsRef = useRef<Map<TPrimaryPageName, string>>(new Map())
  const savedFeedStateRef = useRef<Map<TPrimaryPageName, { 
    eventIds: string[], 
    scrollPosition: number, 
    tab?: string,
    discussionsState?: { selectedTopic: string, timeSpan: '30days' | '90days' | 'all' },
    trendingTab?: 'nostr' | 'relays' | 'hashtags'
  }>>(new Map())
  const restoringScrollRef = useRef<Set<string>>(new Set()) // Track which eventIds are currently being restored
  const currentTabStateRef = useRef<Map<TPrimaryPageName, string>>(new Map()) // Track current tab state for each page
  
  // Helper function to wait for an event element to appear and scroll to it
  // Optionally uses cached feed state to restore scroll position first
  const waitForEventAndScroll = useCallback((eventId: string, page: TPrimaryPageName, maxAttempts = 100, delay = 100) => {
    // Prevent duplicate restoration attempts
    if (restoringScrollRef.current.has(eventId)) {
      logger.debug('PageManager: Already restoring scroll for event', { eventId })
      return
    }
    restoringScrollRef.current.add(eventId)
    
    logger.info('PageManager: Starting waitForEventAndScroll', { eventId, page, isSmallScreen })
    
    let attempts = 0
    let timeoutId: NodeJS.Timeout | null = null
    let observer: MutationObserver | null = null
    let isResolved = false
    let lastScrollHeight = 0
    let stuckAttempts = 0
    
    const scrollToEvent = () => {
      if (isResolved) return
      
      if (isSmallScreen) {
        // Find all elements with this event ID (there might be multiple - original and embedded quotes)
        const allEventElements = Array.from(document.querySelectorAll(`[data-event-id="${eventId}"]`)) as HTMLElement[]
        
        // Filter out embedded notes - they're inside [data-embedded-note] containers or are embedded themselves
        const mainEventElements = allEventElements.filter(el => {
          // Check if this element is inside an embedded note container
          const isInsideEmbedded = el.closest('[data-embedded-note]') !== null
          // Check if this element itself is an embedded note
          const isEmbedded = el.hasAttribute('data-embedded-note')
          return !isInsideEmbedded && !isEmbedded
        })
        
        // If we have cached scroll position, find the element closest to it
        // Otherwise, just use the first main event element
        let eventElement: HTMLElement | null = null
        if (mainEventElements.length > 0) {
          const cachedFeedState = savedFeedStateRef.current.get(page)
          if (cachedFeedState && cachedFeedState.scrollPosition > 0) {
            // Find the element closest to the cached scroll position
            let closestElement: HTMLElement | null = null
            let closestDistance = Infinity
            
            mainEventElements.forEach(el => {
              const rect = el.getBoundingClientRect()
              const elementTop = rect.top + window.scrollY
              const distance = Math.abs(elementTop - cachedFeedState.scrollPosition)
              if (distance < closestDistance) {
                closestDistance = distance
                closestElement = el
              }
            })
            
            eventElement = closestElement || mainEventElements[0]
          } else {
            eventElement = mainEventElements[0]
          }
        }
        
        if (eventElement) {
          // Scroll to top of the feed (event at the top)
          eventElement.scrollIntoView({ behavior: 'instant', block: 'start' })
          logger.info('PageManager: Mobile - Scrolled to saved event at top', { 
            eventId, 
            attempts,
            totalElements: allEventElements.length,
            mainElements: mainEventElements.length
          })
          isResolved = true
          cleanup()
          return true
        }
      } else {
        const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
        if (scrollArea) {
          // Find all elements with this event ID (there might be multiple - original and embedded quotes)
          const allEventElements = Array.from(scrollArea.querySelectorAll(`[data-event-id="${eventId}"]`)) as HTMLElement[]
          
          // Filter out embedded notes - they're inside [data-embedded-note] containers or are embedded themselves
          const mainEventElements = allEventElements.filter(el => {
            // Check if this element is inside an embedded note container
            const isInsideEmbedded = el.closest('[data-embedded-note]') !== null
            // Check if this element itself is an embedded note
            const isEmbedded = el.hasAttribute('data-embedded-note')
            return !isInsideEmbedded && !isEmbedded
          })
          
          // If we have cached scroll position, find the element closest to it
          // Otherwise, just use the first main event element
          let eventElement: HTMLElement | null = null
          if (mainEventElements.length > 0) {
            const cachedFeedState = savedFeedStateRef.current.get(page)
            if (cachedFeedState && cachedFeedState.scrollPosition > 0) {
              // Find the element closest to the cached scroll position
              let closestElement: HTMLElement | null = null
              let closestDistance = Infinity
              
              mainEventElements.forEach(el => {
                const rect = el.getBoundingClientRect()
                const scrollAreaRect = scrollArea.getBoundingClientRect()
                const elementTop = rect.top - scrollAreaRect.top + scrollArea.scrollTop
                const distance = Math.abs(elementTop - cachedFeedState.scrollPosition)
                if (distance < closestDistance) {
                  closestDistance = distance
                  closestElement = el
                }
              })
              
              eventElement = closestElement || mainEventElements[0]
            } else {
              eventElement = mainEventElements[0]
            }
          }
          
          if (eventElement) {
            // Get the element's current position relative to the scroll container
            const scrollAreaRect = scrollArea.getBoundingClientRect()
            const elementRect = eventElement.getBoundingClientRect()
            
            // Calculate where the element currently is relative to the scroll container's viewport
            const elementTopInViewport = elementRect.top - scrollAreaRect.top
            
            // The element's position in the scroll container's content = current viewport position + current scroll position
            const elementTopInContent = elementTopInViewport + scrollArea.scrollTop
            
            // Scroll to position the element at the top (scrollTop = element's position in content)
            scrollArea.scrollTop = elementTopInContent
            
            // Verify after a brief delay to allow scroll to complete
            setTimeout(() => {
              const verifyRect = eventElement.getBoundingClientRect()
              const verifyScrollAreaRect = scrollArea.getBoundingClientRect()
              const actualTop = verifyRect.top - verifyScrollAreaRect.top
              
              // If still not at top, try one more time with a small adjustment
              if (Math.abs(actualTop) > 10) {
                const adjustedScrollTop = scrollArea.scrollTop + actualTop
                scrollArea.scrollTop = adjustedScrollTop
                
                // Verify again
                setTimeout(() => {
                  const finalRect = eventElement.getBoundingClientRect()
                  const finalScrollAreaRect = scrollArea.getBoundingClientRect()
                  const finalTop = finalRect.top - finalScrollAreaRect.top
                  logger.info('PageManager: Desktop - Scrolled to saved event at top (adjusted)', { 
                    eventId, 
                    attempts,
                    elementTopInContent,
                    adjustedScrollTop,
                    actualScrollTop: scrollArea.scrollTop,
                    elementTopRelativeToViewport: finalTop
                  })
                }, 10)
              } else {
                logger.info('PageManager: Desktop - Scrolled to saved event at top', { 
                  eventId, 
                  attempts,
                  elementTopInContent,
                  actualScrollTop: scrollArea.scrollTop,
                  elementTopRelativeToViewport: actualTop
                })
              }
            }, 10)
            
            isResolved = true
            cleanup()
            return true
          } else {
            // Event not found - check if we need to trigger lazy loading by scrolling down
            const allEvents = scrollArea.querySelectorAll('[data-event-id]')
            const loadedEventIds = Array.from(allEvents).map(el => el.getAttribute('data-event-id'))
            const eventIsLoaded = loadedEventIds.includes(eventId)
            
            // If event is not loaded, try to trigger lazy loading
            if (!eventIsLoaded) {
              const currentScrollTop = scrollArea.scrollTop
              const scrollHeight = scrollArea.scrollHeight
              const clientHeight = scrollArea.clientHeight
              const maxScroll = Math.max(0, scrollHeight - clientHeight)
              const cachedFeedState = savedFeedStateRef.current.get(page)
              
              // Check if the target event is in the cached event IDs - if so, we know it should be loaded
              const eventIsInCachedList = cachedFeedState?.eventIds.includes(eventId) ?? false
              
              // If we have cached state and the event is in the cached list, we know it should exist
              // Scroll to bottom to trigger lazy loading, but only if we're not already at the bottom
              if (eventIsInCachedList && cachedFeedState) {
                // Track if scroll height is increasing (content is loading)
                const scrollHeightIncreased = scrollHeight > lastScrollHeight
                if (scrollHeightIncreased) {
                  lastScrollHeight = scrollHeight
                  stuckAttempts = 0
                } else if (lastScrollHeight > 0) {
                  stuckAttempts++
                } else {
                  lastScrollHeight = scrollHeight
                }
                
                // If cached position is beyond current scroll height, we need to load more content
                // Scroll to the bottom to trigger the IntersectionObserver
                if (cachedFeedState.scrollPosition > maxScroll) {
                  // If we're stuck (scroll height not increasing), wait longer before trying again
                  if (stuckAttempts > 5 && attempts > 10) {
                    // Wait a bit longer - content might be loading but DOM hasn't updated yet
                    if (attempts % 10 === 0) {
                      logger.debug('PageManager: Desktop - Scroll height not increasing, waiting for content to load', { 
                        eventId, 
                        attempts,
                        stuckAttempts,
                        scrollHeight,
                        lastScrollHeight,
                        loadedEvents: allEvents.length
                      })
                    }
                    return false
                  }
                  
                  // Scroll to bottom to trigger lazy loading
                  scrollArea.scrollTop = maxScroll
                  
                  if (attempts % 3 === 0 || attempts < 5) {
                    logger.info('PageManager: Desktop - Scrolling to bottom to trigger lazy loading (event in cached list)', { 
                      eventId, 
                      attempts,
                      currentScrollTop,
                      maxScroll,
                      cachedPosition: cachedFeedState.scrollPosition,
                      scrollHeight,
                      loadedEvents: allEvents.length,
                      cachedEventCount: cachedFeedState.eventIds.length,
                      scrollHeightIncreased
                    })
                  }
                  return false
                } else {
                  // Cached position is within current scroll height, but event not found yet
                  // This might mean the event order changed or it's not rendered yet
                  // Scroll towards cached position to trigger loading
                  const distanceToCached = Math.abs(currentScrollTop - cachedFeedState.scrollPosition)
                  if (distanceToCached > 10) {
                    const targetScroll = Math.min(cachedFeedState.scrollPosition, maxScroll)
                    scrollArea.scrollTop = targetScroll
                    
                    if (attempts % 3 === 0 || attempts < 5) {
                      logger.info('PageManager: Desktop - Scrolling towards cached position (event in cached list)', { 
                        eventId, 
                        attempts,
                        currentScrollTop,
                        targetScroll,
                        cachedPosition: cachedFeedState.scrollPosition,
                        scrollHeight,
                        maxScroll,
                        loadedEvents: allEvents.length
                      })
                    }
                    return false
                  }
                }
              } else {
                // Event not in cached list or no cached state - scroll down gradually to trigger lazy loading
                if (maxScroll > 0 && currentScrollTop < maxScroll * 0.95) {
                  // Scroll down more aggressively - by a full viewport or 1000px, whichever is smaller
                  const scrollIncrement = Math.min(clientHeight * 1.0, 1000)
                  const newScrollTop = Math.min(currentScrollTop + scrollIncrement, maxScroll)
                  scrollArea.scrollTop = newScrollTop
                  
                  if (attempts % 5 === 0) {
                    logger.info('PageManager: Desktop - Scrolling down to trigger lazy loading', { 
                      eventId, 
                      attempts,
                      currentScrollTop,
                      newScrollTop,
                      scrollHeight,
                      maxScroll,
                      loadedEvents: allEvents.length,
                      scrollIncrement
                    })
                  }
                } else {
                  if (attempts % 10 === 0) {
                    logger.debug('PageManager: Desktop - Cannot scroll further or at bottom', { 
                      eventId, 
                      attempts,
                      currentScrollTop,
                      maxScroll,
                      scrollPercentage: maxScroll > 0 ? (currentScrollTop / maxScroll).toFixed(2) : 'N/A',
                      loadedEvents: allEvents.length
                    })
                  }
                }
              }
            }
            
            // Log debug info periodically
            if (attempts === 0 || attempts % 10 === 0) {
              logger.debug('PageManager: Desktop - Event not found yet', { 
                eventId, 
                attempts,
                totalEventsInDocument: document.querySelectorAll('[data-event-id]').length,
                totalEventsInScrollArea: allEvents.length,
                eventIsLoaded
              })
            }
          }
        } else {
          if (attempts === 0 || attempts % 10 === 0) {
            logger.debug('PageManager: Desktop - ScrollArea not found yet', { eventId, attempts })
          }
        }
      }
      return false
    }
    
    const tryScroll = () => {
      if (isResolved) return
      attempts++
      
      if (scrollToEvent()) {
        return
      }
      
      if (attempts < maxAttempts) {
        timeoutId = setTimeout(tryScroll, delay)
      } else {
        // Final debug: Check what events are actually in the DOM
        const allEvents = document.querySelectorAll('[data-event-id]')
        const eventIds = Array.from(allEvents).slice(0, 10).map(el => el.getAttribute('data-event-id'))
        const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
        const scrollAreaEvents = scrollArea ? scrollArea.querySelectorAll('[data-event-id]') : []
        const scrollAreaEventIds = Array.from(scrollAreaEvents).slice(0, 10).map(el => el.getAttribute('data-event-id'))
        
        logger.warn('PageManager: Could not find saved event element after max attempts', { 
          eventId, 
          page, 
          attempts,
          totalEventsInDocument: allEvents.length,
          totalEventsInScrollArea: scrollAreaEvents.length,
          sampleEventIds: eventIds,
          sampleScrollAreaEventIds: scrollAreaEventIds
        })
        cleanup()
      }
    }
    
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (observer) {
        observer.disconnect()
        observer = null
      }
      restoringScrollRef.current.delete(eventId)
    }
    
    // Wait a bit for the page to render before trying
    setTimeout(() => {
      // First, restore scroll position from cached feed state to trigger lazy loading
      const cachedFeedState = savedFeedStateRef.current.get(page)
      const eventIsInCachedList = cachedFeedState?.eventIds.includes(eventId) ?? false
      logger.debug('PageManager: Checking cached feed state for restoration', { 
        page, 
        hasCachedState: !!cachedFeedState,
        cachedScrollPosition: cachedFeedState?.scrollPosition,
        cachedEventCount: cachedFeedState?.eventIds.length,
        eventIdInCachedList: eventIsInCachedList,
        allCachedPages: Array.from(savedFeedStateRef.current.keys())
      })
      
      if (cachedFeedState && !eventIsInCachedList) {
        logger.warn('PageManager: Target event not in cached event list - may not exist in feed', { 
          eventId, 
          page,
          cachedEventCount: cachedFeedState.eventIds.length,
          sampleCachedIds: cachedFeedState.eventIds.slice(0, 5)
        })
      }
      
      if (cachedFeedState && cachedFeedState.scrollPosition > 0) {
        if (isSmallScreen) {
          window.scrollTo({ top: cachedFeedState.scrollPosition, behavior: 'instant' })
          logger.info('PageManager: Mobile - Restored scroll position from cache', { 
            page, 
            scrollPosition: cachedFeedState.scrollPosition,
            cachedEventCount: cachedFeedState.eventIds.length
          })
        } else {
          const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
          if (scrollArea) {
            const maxScroll = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight)
            const needsMoreContent = cachedFeedState.scrollPosition > maxScroll
            
            // If cached position is beyond current scroll height, scroll to bottom to trigger loading
            // Otherwise, scroll to the cached position
            const targetScroll = needsMoreContent ? maxScroll : Math.min(cachedFeedState.scrollPosition, maxScroll)
            scrollArea.scrollTop = targetScroll
            
            logger.info('PageManager: Desktop - Restored scroll position from cache', { 
              page, 
              scrollPosition: cachedFeedState.scrollPosition,
              targetScroll,
              cachedEventCount: cachedFeedState.eventIds.length,
              scrollAreaScrollHeight: scrollArea.scrollHeight,
              maxScroll,
              needsMoreContent,
              eventIdInCachedList: cachedFeedState.eventIds.includes(eventId)
            })
          } else {
            logger.warn('PageManager: Desktop - ScrollArea not found when trying to restore cached position', { page })
          }
        }
      } else {
        logger.debug('PageManager: No cached scroll position to restore', { 
          page, 
          hasCachedState: !!cachedFeedState,
          cachedScrollPosition: cachedFeedState?.scrollPosition
        })
      }
      
      // Wait a bit longer for lazy loading to trigger after restoring scroll position
      setTimeout(() => {
        // Try to find and scroll to the event
        if (scrollToEvent()) {
          return
        }
        
        // Set up MutationObserver to watch for when the element appears
        const targetNode = isSmallScreen ? document.body : document.querySelector('[data-radix-scroll-area-viewport]') || document.body
        if (targetNode) {
          observer = new MutationObserver(() => {
            if (!isResolved && scrollToEvent()) {
              return
            }
          })
          
          observer.observe(targetNode, {
            childList: true,
            subtree: true,
            attributes: false
          })
          logger.debug('PageManager: MutationObserver set up', { eventId, targetNode: targetNode.tagName })
        } else {
          logger.warn('PageManager: Could not find target node for MutationObserver', { eventId, isSmallScreen })
        }
        
        // Also poll as a fallback
        timeoutId = setTimeout(tryScroll, delay)
      }, 300) // Wait 300ms after restoring scroll position for lazy loading to trigger
      
      // Cleanup after max time (maxAttempts * delay)
      setTimeout(() => {
        if (!isResolved) {
          // Final debug: Check what events are actually in the DOM
          const allEvents = document.querySelectorAll('[data-event-id]')
          const eventIds = Array.from(allEvents).slice(0, 20).map(el => el.getAttribute('data-event-id'))
          const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
          const scrollAreaEvents = scrollArea ? scrollArea.querySelectorAll('[data-event-id]') : []
          const scrollAreaEventIds = Array.from(scrollAreaEvents).slice(0, 20).map(el => el.getAttribute('data-event-id'))
          const eventExistsInDocument = Array.from(allEvents).some(el => el.getAttribute('data-event-id') === eventId)
          const eventExistsInScrollArea = scrollArea ? Array.from(scrollAreaEvents).some(el => el.getAttribute('data-event-id') === eventId) : false
          
          logger.warn('PageManager: waitForEventAndScroll timed out', { 
            eventId, 
            page, 
            attempts,
            totalEventsInDocument: allEvents.length,
            totalEventsInScrollArea: scrollAreaEvents.length,
            eventExistsInDocument,
            eventExistsInScrollArea,
            sampleEventIds: eventIds,
            sampleScrollAreaEventIds: scrollAreaEventIds,
            scrollAreaExists: !!scrollArea
          })
          cleanup()
        }
      }, maxAttempts * delay)
    }, 200) // Wait 200ms for initial render
  }, [isSmallScreen])
  
  const setPrimaryNoteView = (view: ReactNode | null, type?: 'note' | 'settings' | 'settings-sub' | 'profile' | 'hashtag' | 'relay' | 'following' | 'mute' | 'others-relay-settings') => {
    if (view && !primaryNoteView) {
      // Saving current primary page before showing overlay
      setSavedPrimaryPage(currentPrimaryPage)
      
      // Find the event that's currently visible in the viewport and save its ID
      // Also cache the feed state (all visible event IDs and scroll position)
      const findVisibleEventIdAndCacheFeedState = () => {
        if (isSmallScreen) {
          // On mobile, find event in window viewport
          const viewportCenter = window.scrollY + window.innerHeight / 2
          const allEvents = document.querySelectorAll('[data-event-id]')
          let closestEvent: HTMLElement | null = null
          let closestDistance = Infinity
          const eventIds: string[] = []
          
          allEvents.forEach((el) => {
            const eventId = el.getAttribute('data-event-id')
            if (eventId) {
              eventIds.push(eventId)
            }
            const rect = el.getBoundingClientRect()
            const elementCenter = rect.top + window.scrollY + rect.height / 2
            const distance = Math.abs(elementCenter - viewportCenter)
            if (distance < closestDistance) {
              closestDistance = distance
              closestEvent = el as HTMLElement
            }
          })
          
          const visibleEventId = (closestEvent as HTMLElement | null)?.getAttribute('data-event-id')
          const scrollPosition = window.scrollY
          
          return { visibleEventId, eventIds, scrollPosition }
        } else {
          // On desktop, find event in ScrollArea viewport
          const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
          if (scrollArea) {
            const viewportCenter = scrollArea.scrollTop + scrollArea.clientHeight / 2
            const allEvents = scrollArea.querySelectorAll('[data-event-id]')
            let closestEvent: HTMLElement | null = null
            let closestDistance = Infinity
            const eventIds: string[] = []
            
            allEvents.forEach((el) => {
              const eventId = el.getAttribute('data-event-id')
              if (eventId) {
                eventIds.push(eventId)
              }
              const rect = el.getBoundingClientRect()
              const scrollAreaRect = scrollArea.getBoundingClientRect()
              const elementTop = rect.top - scrollAreaRect.top + scrollArea.scrollTop
              const elementCenter = elementTop + rect.height / 2
              const distance = Math.abs(elementCenter - viewportCenter)
              if (distance < closestDistance) {
                closestDistance = distance
                closestEvent = el as HTMLElement
              }
            })
            
            const visibleEventId = (closestEvent as HTMLElement | null)?.getAttribute('data-event-id')
            const scrollPosition = scrollArea.scrollTop
            
            return { visibleEventId, eventIds, scrollPosition }
          }
        }
        return { visibleEventId: null, eventIds: [], scrollPosition: 0 }
      }
      
      const { visibleEventId, eventIds, scrollPosition } = findVisibleEventIdAndCacheFeedState()
      
      // Get current tab state from ref (updated by components via events)
      const currentTab = currentTabStateRef.current.get(currentPrimaryPage)
      
      // Get Discussions state if on discussions page
      let discussionsState: { selectedTopic: string, timeSpan: '30days' | '90days' | 'all' } | undefined = undefined
      if (currentPrimaryPage === 'discussions') {
        // Request discussions state from component
        const stateEvent = new CustomEvent('requestDiscussionsState')
        let receivedState: { selectedTopic: string, timeSpan: '30days' | '90days' | 'all' } | null = null
        const handler = ((e: CustomEvent) => {
          receivedState = e.detail
        }) as EventListener
        window.addEventListener('discussionsStateResponse', handler)
        window.dispatchEvent(stateEvent)
        setTimeout(() => {
          window.removeEventListener('discussionsStateResponse', handler)
          if (receivedState) {
            discussionsState = receivedState
          }
        }, 10)
      }
      
      // Get trending tab if on search page
      const trendingTab = currentTabStateRef.current.get('search') as 'nostr' | 'relays' | 'hashtags' | undefined
      
      if (visibleEventId) {
        logger.info('PageManager: Saving visible event ID and feed state', { 
          page: currentPrimaryPage, 
          eventId: visibleEventId,
          eventCount: eventIds.length,
          scrollPosition,
          tab: currentTab,
          discussionsState,
          trendingTab
        })
        savedEventIdsRef.current.set(currentPrimaryPage, visibleEventId)
        savedFeedStateRef.current.set(currentPrimaryPage, { 
          eventIds, 
          scrollPosition, 
          tab: currentTab,
          discussionsState,
          trendingTab
        })
      } else if (scrollPosition > 0 || currentTab || discussionsState || trendingTab) {
        // Save scroll position even if no event ID (for pages without event IDs like notifications, explore)
        logger.info('PageManager: Saving scroll position and state (no event ID)', { 
          page: currentPrimaryPage, 
          scrollPosition,
          tab: currentTab,
          discussionsState,
          trendingTab
        })
        savedFeedStateRef.current.set(currentPrimaryPage, { 
          eventIds: [], 
          scrollPosition, 
          tab: currentTab,
          discussionsState,
          trendingTab
        })
      }
    }
    
    // Increment navigation counter when setting a new view to ensure unique keys
    // This forces React to remount components even when navigating between items of the same type
    if (view) {
      navigationCounterRef.current += 1
    }
    
    // Always update the view state - even if the type is the same, the component might be different
    // This ensures that navigation works even when navigating between items of the same type (e.g., different hashtags)
    setPrimaryNoteViewState(view)
    setPrimaryViewType(type || null)
    
    // If clearing the view, restore to the saved primary page
    if (!view && savedPrimaryPage) {
      const newUrl = savedPrimaryPage === 'home' ? '/' : `/?page=${savedPrimaryPage}`
      window.history.replaceState(null, '', newUrl)
      
      const savedFeedState = savedFeedStateRef.current.get(savedPrimaryPage)
      const savedEventId = savedEventIdsRef.current.get(savedPrimaryPage)
      
      // Restore tab state first
      if (savedFeedState?.tab) {
        logger.info('PageManager: Restoring tab state', { page: savedPrimaryPage, tab: savedFeedState.tab })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: savedPrimaryPage, tab: savedFeedState.tab } 
        }))
        currentTabStateRef.current.set(savedPrimaryPage, savedFeedState.tab)
      }
      
      // Restore Discussions state
      if (savedFeedState?.discussionsState && savedPrimaryPage === 'discussions') {
        logger.info('PageManager: Restoring Discussions state', { 
          page: savedPrimaryPage, 
          discussionsState: savedFeedState.discussionsState 
        })
        window.dispatchEvent(new CustomEvent('restoreDiscussionsState', { 
          detail: { page: savedPrimaryPage, discussionsState: savedFeedState.discussionsState } 
        }))
      }
      
      // Restore trending tab for search page
      if (savedFeedState?.trendingTab && savedPrimaryPage === 'search') {
        logger.info('PageManager: Restoring trending tab', { 
          page: savedPrimaryPage, 
          trendingTab: savedFeedState.trendingTab 
        })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: 'search', tab: savedFeedState.trendingTab } 
        }))
        currentTabStateRef.current.set('search', savedFeedState.trendingTab)
      }
      
      // Scroll to the saved event or position
      if (savedEventId) {
        logger.info('PageManager: Restoring to saved event', { page: savedPrimaryPage, eventId: savedEventId })
        try {
          waitForEventAndScroll(savedEventId, savedPrimaryPage)
        } catch (error) {
          logger.error('PageManager: Error calling waitForEventAndScroll', { error, savedEventId, savedPrimaryPage })
        }
      } else if (savedFeedState && savedFeedState.scrollPosition > 0) {
        // Restore scroll position for pages without event IDs
        logger.info('PageManager: Restoring scroll position (no event ID)', { 
          page: savedPrimaryPage, 
          scrollPosition: savedFeedState.scrollPosition 
        })
        // Wait longer for content to load, then restore scroll position
        setTimeout(() => {
          const restoreScroll = () => {
            if (isSmallScreen) {
              window.scrollTo({ top: savedFeedState.scrollPosition, behavior: 'instant' })
            } else {
              const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
              if (scrollArea) {
                const maxScroll = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight)
                const targetScroll = Math.min(savedFeedState.scrollPosition, maxScroll)
                scrollArea.scrollTop = targetScroll
                
                // If content hasn't loaded enough yet, try again after a delay
                if (targetScroll < savedFeedState.scrollPosition && maxScroll < savedFeedState.scrollPosition) {
                  setTimeout(restoreScroll, 200)
                }
              }
            }
          }
          restoreScroll()
        }, 300)
      }
    }
  }

  const goBack = () => {
    // Special handling for settings sub-pages - go back to main settings page
    if (primaryViewType === 'settings-sub') {
      window.history.pushState(null, '', '/settings')
      setPrimaryNoteView(<SettingsPage index={0} hideTitlebar={true} />, 'settings')
    } else if (primaryViewType === 'following' || primaryViewType === 'mute' || primaryViewType === 'others-relay-settings') {
      // Special handling for profile sub-pages - go back to main profile page
      const currentPath = window.location.pathname
      const profileId = currentPath.replace('/users/', '').replace('/following', '').replace('/muted', '').replace('/relays', '')
      const profileUrl = `/users/${profileId}`
      window.history.pushState(null, '', profileUrl)
      setPrimaryNoteView(<SecondaryProfilePage id={profileId} index={0} hideTitlebar={true} />, 'profile')
    } else {
      // Use browser's back functionality for other pages
      window.history.back()
    }
  }
  const ignorePopStateRef = useRef(false)

  // Handle browser back button
  useEffect(() => {
    const handlePopState = () => {
      if (ignorePopStateRef.current) {
        ignorePopStateRef.current = false
        return
      }
      
      // If we have a primary note view open, close it and go back to the main page
      if (primaryNoteView) {
        setPrimaryNoteView(null)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [primaryNoteView])

  useEffect(() => {
    if (['/npub1', '/nprofile1'].some((prefix) => window.location.pathname.startsWith(prefix))) {
      window.history.replaceState(
        null,
        '',
        '/users' + window.location.pathname + window.location.search + window.location.hash
      )
    } else if (
      ['/note1', '/nevent1', '/naddr1'].some((prefix) =>
        window.location.pathname.startsWith(prefix)
      )
    ) {
      window.history.replaceState(
        null,
        '',
        '/notes' + window.location.pathname + window.location.search + window.location.hash
      )
    }
    window.history.pushState(null, '', window.location.href)
    if (window.location.pathname !== '/') {
      const url = window.location.pathname + window.location.search + window.location.hash
      
      // DEPRECATED: Double-panel logic removed - always add to secondary stack
      setSecondaryStack((prevStack) => {
        if (isCurrentPage(prevStack, url)) return prevStack

        const { newStack, newItem } = pushNewPageToStack(
          prevStack,
          url,
          maxStackSize,
          window.history.state?.index
        )
        if (newItem) {
          window.history.replaceState({ index: newItem.index, url }, '', url)
        }
        return newStack
      })
    } else {
      const searchParams = new URLSearchParams(window.location.search)
      const r = searchParams.get('r')
      const page = searchParams.get('page')
      
      if (r) {
        const url = normalizeUrl(r)
        if (url) {
          navigatePrimaryPage('relay', { url })
        }
      } else if (page && page in PRIMARY_PAGE_MAP) {
        navigatePrimaryPage(page as TPrimaryPageName)
      }
    }

    const onPopState = (e: PopStateEvent) => {
      if (ignorePopStateRef.current) {
        ignorePopStateRef.current = false
        return
      }

      const closeModal = modalManager.pop()
      if (closeModal) {
        ignorePopStateRef.current = true
        window.history.forward()
        return
      }

      let state = e.state as { index: number; url: string } | null
      setSecondaryStack((pre) => {
        const currentItem = pre[pre.length - 1] as TStackItem | undefined
        const currentIndex = currentItem?.index
        if (!state) {
          if (window.location.pathname + window.location.search + window.location.hash !== '/') {
            // Just change the URL
            return pre
          } else {
            // Back to root
            state = { index: -1, url: '/' }
          }
        }

        // Go forward
        if (currentIndex === undefined || state.index > currentIndex) {
          const { newStack } = pushNewPageToStack(pre, state.url, maxStackSize)
          return newStack
        }

        if (state.index === currentIndex) {
          return pre
        }

        // Go back
        const newStack = pre.filter((item) => item.index <= state!.index)
        const topItem = newStack[newStack.length - 1] as TStackItem | undefined
        if (!topItem) {
          // Create a new stack item if it's not exist (e.g. when the user refreshes the page, the stack will be empty)
          const { component, ref } = findAndCreateComponent(state.url, state.index)
          if (component) {
            newStack.push({
              index: state.index,
              url: state.url,
              component,
              ref
            })
          }
        } else if (!topItem.component) {
          // Load the component if it's not cached
          const { component, ref } = findAndCreateComponent(topItem.url, state.index)
          if (component) {
            topItem.component = component
            topItem.ref = ref
          }
        }
        if (newStack.length === 0) {
          window.history.replaceState(null, '', '/')
        }
        return newStack
      })
    }

    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  // Listen for tab state changes from components
  useEffect(() => {
    const handleTabChange = (e: CustomEvent<{ page: TPrimaryPageName, tab: string }>) => {
      currentTabStateRef.current.set(e.detail.page, e.detail.tab)
      logger.debug('PageManager: Tab state updated', { page: e.detail.page, tab: e.detail.tab })
    }
    
    window.addEventListener('pageTabChanged', handleTabChange as EventListener)
    return () => {
      window.removeEventListener('pageTabChanged', handleTabChange as EventListener)
    }
  }, [])
  
  // Restore scroll position and tab state when returning to primary page from browser back button
  useEffect(() => {
    if (secondaryStack.length === 0 && currentPrimaryPage) {
      const savedFeedState = savedFeedStateRef.current.get(currentPrimaryPage)
      const savedEventId = savedEventIdsRef.current.get(currentPrimaryPage)
      
      // Restore tab state first
      if (savedFeedState?.tab) {
        logger.info('PageManager: Browser back - Restoring tab state', { page: currentPrimaryPage, tab: savedFeedState.tab })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: currentPrimaryPage, tab: savedFeedState.tab } 
        }))
        // Update ref immediately
        currentTabStateRef.current.set(currentPrimaryPage, savedFeedState.tab)
      }
      
      // Restore Discussions state
      if (savedFeedState?.discussionsState && currentPrimaryPage === 'discussions') {
        logger.info('PageManager: Browser back - Restoring Discussions state', { 
          page: currentPrimaryPage, 
          discussionsState: savedFeedState.discussionsState 
        })
        window.dispatchEvent(new CustomEvent('restoreDiscussionsState', { 
          detail: { page: currentPrimaryPage, discussionsState: savedFeedState.discussionsState } 
        }))
      }
      
      // Restore trending tab for search page
      if (savedFeedState?.trendingTab && currentPrimaryPage === 'search') {
        logger.info('PageManager: Browser back - Restoring trending tab', { 
          page: currentPrimaryPage, 
          trendingTab: savedFeedState.trendingTab 
        })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: 'search', tab: savedFeedState.trendingTab } 
        }))
        currentTabStateRef.current.set('search', savedFeedState.trendingTab)
      }
      
      // Restore scroll position
      if (savedEventId) {
        logger.info('PageManager: Browser back - Restoring to saved event', { page: currentPrimaryPage, eventId: savedEventId })
        try {
          waitForEventAndScroll(savedEventId, currentPrimaryPage)
        } catch (error) {
          logger.error('PageManager: Error calling waitForEventAndScroll from useEffect', { error, savedEventId, currentPrimaryPage })
        }
      } else if (savedFeedState && savedFeedState.scrollPosition > 0) {
        // Restore scroll position for pages without event IDs
        logger.info('PageManager: Browser back - Restoring scroll position (no event ID)', { 
          page: currentPrimaryPage, 
          scrollPosition: savedFeedState.scrollPosition 
        })
        // Wait longer for content to load, then restore scroll position
        setTimeout(() => {
          const restoreScroll = () => {
            if (isSmallScreen) {
              window.scrollTo({ top: savedFeedState.scrollPosition, behavior: 'instant' })
            } else {
              const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
              if (scrollArea) {
                const maxScroll = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight)
                const targetScroll = Math.min(savedFeedState.scrollPosition, maxScroll)
                scrollArea.scrollTop = targetScroll
                
                // If content hasn't loaded enough yet, try again after a delay
                if (targetScroll < savedFeedState.scrollPosition && maxScroll < savedFeedState.scrollPosition) {
                  setTimeout(restoreScroll, 200)
                }
              }
            }
          }
          restoreScroll()
        }, 300)
      }
    }
  }, [secondaryStack.length, currentPrimaryPage, waitForEventAndScroll, isSmallScreen])


  const navigatePrimaryPage = (page: TPrimaryPageName, props?: any) => {
    const needScrollToTop = page === currentPrimaryPage
    
    // Clear any primary note view when navigating to a new primary page
    // This ensures menu clicks always take you to the primary page, not stuck on overlays
    setPrimaryNoteView(null)
    
    // Always clear secondary pages when navigating to a primary page via menu
    // This ensures clicking menu items always takes you to that page, not stuck on profile/note pages
    clearSecondaryPages()
    
    // Update primary pages and current page
    setPrimaryPages((prev) => {
      const exists = prev.find((p) => p.name === page)
      if (exists && props) {
        exists.props = props
        return [...prev]
      } else if (!exists) {
        return [...prev, { name: page, element: PRIMARY_PAGE_MAP[page], props }]
      }
      return prev
    })
    setCurrentPrimaryPage(page)
    
    // Update URL for primary pages (except home)
    const newUrl = page === 'home' ? '/' : `/?page=${page}`
    window.history.pushState(null, '', newUrl)
    
    if (needScrollToTop) {
      PRIMARY_PAGE_REF_MAP[page].current?.scrollToTop('smooth')
    }
  }


  const pushSecondaryPage = (url: string, index?: number) => {
    logger.component('PageManager', 'pushSecondaryPage called', { url })
    
    // Find and save the visible event ID and feed state before navigating
    const findVisibleEventIdAndCacheFeedState = () => {
      const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
      if (scrollArea) {
        const viewportCenter = scrollArea.scrollTop + scrollArea.clientHeight / 2
        const allEvents = scrollArea.querySelectorAll('[data-event-id]')
        let closestEvent: HTMLElement | null = null
        let closestDistance = Infinity
        const eventIds: string[] = []
        
        allEvents.forEach((el) => {
          const eventId = el.getAttribute('data-event-id')
          if (eventId) {
            eventIds.push(eventId)
          }
          const rect = el.getBoundingClientRect()
          const scrollAreaRect = scrollArea.getBoundingClientRect()
          const elementTop = rect.top - scrollAreaRect.top + scrollArea.scrollTop
          const elementCenter = elementTop + rect.height / 2
          const distance = Math.abs(elementCenter - viewportCenter)
          if (distance < closestDistance) {
            closestDistance = distance
            closestEvent = el as HTMLElement
          }
        })
        
        const visibleEventId = (closestEvent as HTMLElement | null)?.getAttribute('data-event-id')
        const scrollPosition = scrollArea.scrollTop
        
        return { visibleEventId, eventIds, scrollPosition }
      }
      return { visibleEventId: null, eventIds: [], scrollPosition: 0 }
    }
    
    const { visibleEventId, eventIds, scrollPosition } = findVisibleEventIdAndCacheFeedState()
    const currentTab = currentTabStateRef.current.get(currentPrimaryPage)
    
    // Get trending tab if on search page
    const trendingTab = currentTabStateRef.current.get('search') as 'nostr' | 'relays' | 'hashtags' | undefined
    
    if (visibleEventId && currentPrimaryPage) {
      logger.info('PageManager: Desktop - Saving visible event ID and feed state', { 
        page: currentPrimaryPage, 
        eventId: visibleEventId,
        eventCount: eventIds.length,
        scrollPosition,
        tab: currentTab,
        trendingTab
      })
      savedEventIdsRef.current.set(currentPrimaryPage, visibleEventId)
      savedFeedStateRef.current.set(currentPrimaryPage, { eventIds, scrollPosition, tab: currentTab, trendingTab })
    } else if (currentPrimaryPage && (scrollPosition > 0 || currentTab || trendingTab)) {
      // Save scroll position even if no event ID (for pages without event IDs)
      logger.info('PageManager: Desktop - Saving scroll position and state (no event ID)', { 
        page: currentPrimaryPage, 
        scrollPosition,
        tab: currentTab,
        trendingTab
      })
      savedFeedStateRef.current.set(currentPrimaryPage, { eventIds: [], scrollPosition, tab: currentTab, trendingTab })
    }
    
    setSecondaryStack((prevStack) => {
      logger.component('PageManager', 'Current secondary stack length', { length: prevStack.length })
      
      // For relay pages, clear the stack and start fresh to avoid confusion
      if (url.startsWith('/relays/')) {
        logger.component('PageManager', 'Clearing stack for relay navigation')
        const { newStack, newItem } = pushNewPageToStack([], url, maxStackSize, 0)
        logger.component('PageManager', 'New stack created', { 
          newStackLength: newStack.length, 
          hasNewItem: !!newItem 
        })
        if (newItem) {
          window.history.pushState({ index: newItem.index, url }, '', url)
        }
        return newStack
      }
      
      if (isCurrentPage(prevStack, url)) {
        logger.component('PageManager', 'Page already exists, scrolling to top')
        const currentItem = prevStack[prevStack.length - 1]
        if (currentItem?.ref?.current) {
          currentItem.ref.current.scrollToTop('instant')
        }
        return prevStack
      }

      logger.component('PageManager', 'Creating new page for URL', { url, prevStackLength: prevStack.length })
      const { newStack, newItem } = pushNewPageToStack(prevStack, url, maxStackSize, index)
      logger.component('PageManager', 'New page created', { 
        newStackLength: newStack.length, 
        prevStackLength: prevStack.length,
        hasNewItem: !!newItem,
        newItemUrl: newItem?.url,
        newItemIndex: newItem?.index
      })
      if (newItem) {
        window.history.pushState({ index: newItem.index, url }, '', url)
      } else {
        logger.error('PageManager', 'Failed to create component for URL - component will not be displayed', { url, path: url.split('?')[0].split('#')[0] })
      }
      return newStack
    })
  }

  const popSecondaryPage = () => {
    if (secondaryStack.length === 1) {
      // back to home page - restore to saved event
      window.history.replaceState(null, '', '/')
      setSecondaryStack([])
      
      const savedFeedState = savedFeedStateRef.current.get(currentPrimaryPage)
      const savedEventId = savedEventIdsRef.current.get(currentPrimaryPage)
      
      // Restore tab state first
      if (savedFeedState?.tab) {
        logger.info('PageManager: Desktop - Restoring tab state', { page: currentPrimaryPage, tab: savedFeedState.tab })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: currentPrimaryPage, tab: savedFeedState.tab } 
        }))
        currentTabStateRef.current.set(currentPrimaryPage, savedFeedState.tab)
      }
      
      // Restore Discussions state
      if (savedFeedState?.discussionsState && currentPrimaryPage === 'discussions') {
        logger.info('PageManager: Desktop - Restoring Discussions state', { 
          page: currentPrimaryPage, 
          discussionsState: savedFeedState.discussionsState 
        })
        window.dispatchEvent(new CustomEvent('restoreDiscussionsState', { 
          detail: { page: currentPrimaryPage, discussionsState: savedFeedState.discussionsState } 
        }))
      }
      
      // Restore trending tab for search page
      if (savedFeedState?.trendingTab && currentPrimaryPage === 'search') {
        logger.info('PageManager: Desktop - Restoring trending tab', { 
          page: currentPrimaryPage, 
          trendingTab: savedFeedState.trendingTab 
        })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: 'search', tab: savedFeedState.trendingTab } 
        }))
        currentTabStateRef.current.set('search', savedFeedState.trendingTab)
      }
      
      // Scroll to the saved event or position
      if (savedEventId) {
        logger.info('PageManager: Desktop - Restoring to saved event', { page: currentPrimaryPage, eventId: savedEventId })
        try {
          waitForEventAndScroll(savedEventId, currentPrimaryPage)
        } catch (error) {
          logger.error('PageManager: Error calling waitForEventAndScroll from popSecondaryPage', { error, savedEventId, currentPrimaryPage })
        }
      } else if (savedFeedState && savedFeedState.scrollPosition > 0) {
        // Restore scroll position for pages without event IDs
        logger.info('PageManager: Desktop - Restoring scroll position (no event ID)', { 
          page: currentPrimaryPage, 
          scrollPosition: savedFeedState.scrollPosition 
        })
        // Wait longer for content to load, then restore scroll position
        setTimeout(() => {
          const restoreScroll = () => {
            if (isSmallScreen) {
              window.scrollTo({ top: savedFeedState.scrollPosition, behavior: 'instant' })
            } else {
              const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
              if (scrollArea) {
                const maxScroll = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight)
                const targetScroll = Math.min(savedFeedState.scrollPosition, maxScroll)
                scrollArea.scrollTop = targetScroll
                
                // If content hasn't loaded enough yet, try again after a delay
                if (targetScroll < savedFeedState.scrollPosition && maxScroll < savedFeedState.scrollPosition) {
                  setTimeout(restoreScroll, 200)
                }
              }
            }
          }
          restoreScroll()
        }, 300)
      }
    } else {
      window.history.go(-1)
    }
  }

  const clearSecondaryPages = () => {
    if (secondaryStack.length === 0) return
    // Capture the length before clearing
    const stackLength = secondaryStack.length
    // Clear the state immediately for instant navigation
    setSecondaryStack([])
    // Also update browser history to keep it in sync
    window.history.go(-stackLength)
  }

  if (isSmallScreen) {
    return (
      <PrimaryPageContext.Provider
        value={{
          navigate: navigatePrimaryPage,
          current: currentPrimaryPage,
          display: secondaryStack.length === 0
        }}
      >
        <SecondaryPageContext.Provider
          value={{
            push: pushSecondaryPage,
            pop: popSecondaryPage,
            currentIndex: secondaryStack.length
              ? secondaryStack[secondaryStack.length - 1].index
              : 0
          }}
        >
        <CurrentRelaysProvider>
          <NotificationProvider>
            <PrimaryNoteViewContext.Provider value={{ setPrimaryNoteView, primaryViewType, getNavigationCounter: () => navigationCounterRef.current }}>
            {primaryNoteView ? (
              // Show primary note view with back button on mobile
              <div className="flex flex-col h-full w-full">
                <div className="flex justify-center py-1 border-b">
                  <span className="text-green-600 dark:text-green-500 font-semibold text-sm">
                    Imwald
                  </span>
                </div>
                <div className="flex gap-1 p-1 items-center justify-between font-semibold border-b">
                  <div className="flex items-center flex-1 w-0">
                    <Button
                      className="flex gap-1 items-center w-fit max-w-full justify-start pl-2 pr-3"
                      variant="ghost"
                      size="titlebar-icon"
                      title="Back to feed"
                      onClick={() => setPrimaryNoteView(null)}
                    >
                      <ChevronLeft />
                      <div className="truncate text-lg font-semibold">
                        {primaryViewType === 'settings' ? 'Settings' : 
                         primaryViewType === 'settings-sub' ? 'Settings' : 
                         primaryViewType === 'profile' ? 'Back' : 
                         primaryViewType === 'hashtag' ? 'Hashtag' : 
                         primaryViewType === 'note' ? getPageTitle(primaryViewType, window.location.pathname) : 'Note'}
                      </div>
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto">
                  {primaryNoteView}
                </div>
              </div>
            ) : (
              <>
                {!!secondaryStack.length &&
                  secondaryStack.map((item, index) => {
                    const isLast = index === secondaryStack.length - 1
                    logger.component('PageManager', 'Rendering secondary stack item', { 
                      index, 
                      isLast, 
                      url: item.url, 
                      hasComponent: !!item.component,
                      display: isLast ? 'block' : 'none'
                    })
                    return (
                      <div
                        key={item.index}
                        style={{
                          display: isLast ? 'block' : 'none'
                        }}
                      >
                        {item.component}
                      </div>
                    )
                  })}
                {primaryPages.map(({ name, element, props }) => (
                  <div
                    key={name}
                    style={{
                      display:
                        secondaryStack.length === 0 && currentPrimaryPage === name ? 'block' : 'none'
                    }}
                  >
                    {props ? cloneElement(element as React.ReactElement, props) : element}
                  </div>
                ))}
              </>
            )}
            <BottomNavigationBar />
            <TooManyRelaysAlertDialog />
            <CreateWalletGuideToast />
            </PrimaryNoteViewContext.Provider>
          </NotificationProvider>
        </CurrentRelaysProvider>
        </SecondaryPageContext.Provider>
      </PrimaryPageContext.Provider>
    )
  }

  return (
    <PrimaryPageContext.Provider
      value={{
        navigate: navigatePrimaryPage,
        current: currentPrimaryPage,
        display: true
      }}
    >
      <SecondaryPageContext.Provider
        value={{
          push: pushSecondaryPage,
          pop: popSecondaryPage,
          currentIndex: secondaryStack.length ? secondaryStack[secondaryStack.length - 1].index : 0
        }}
      >
        <CurrentRelaysProvider>
          <NotificationProvider>
            <PrimaryNoteViewContext.Provider value={{ setPrimaryNoteView, primaryViewType, getNavigationCounter: () => navigationCounterRef.current }}>
            <div className="flex flex-col items-center bg-surface-background">
              <div
                className="flex h-[var(--vh)] w-full bg-surface-background"
                style={{
                  maxWidth: '1920px'
                }}
              >
                <Sidebar />
                {secondaryStack.length > 0 ? (
                  // Show secondary pages when there are any in the stack
                  <div className="flex-1 overflow-auto">
                    {secondaryStack.map((item, index) => {
                      const isLast = index === secondaryStack.length - 1
                      logger.component('PageManager', 'Rendering desktop secondary stack item', { 
                        index, 
                        isLast, 
                        url: item.url, 
                        hasComponent: !!item.component,
                        display: isLast ? 'block' : 'none'
                      })
                      return (
                        <div
                          key={item.index}
                          style={{
                            display: isLast ? 'block' : 'none'
                          }}
                        >
                          {item.component}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  // Show primary pages when no secondary pages
                  <MainContentArea 
                    primaryPages={primaryPages}
                    currentPrimaryPage={currentPrimaryPage}
                    primaryNoteView={primaryNoteView}
                    primaryViewType={primaryViewType}
                    goBack={goBack}
                  />
                )}
              </div>
            </div>
            <TooManyRelaysAlertDialog />
            <CreateWalletGuideToast />
            </PrimaryNoteViewContext.Provider>
          </NotificationProvider>
        </CurrentRelaysProvider>
      </SecondaryPageContext.Provider>
    </PrimaryPageContext.Provider>
  )
}

export function SecondaryPageLink({
  to,
  children,
  className,
  onClick
}: {
  to: string
  children: React.ReactNode
  className?: string
  onClick?: (e: React.MouseEvent) => void
}) {
  const { push } = useSecondaryPage()

  return (
    <span
      className={cn('cursor-pointer', className)}
      onClick={(e) => {
        if (onClick) {
          onClick(e)
        }
        push(to)
      }}
    >
      {children}
    </span>
  )
}

function isCurrentPage(stack: TStackItem[], url: string) {
  const currentPage = stack[stack.length - 1]
  if (!currentPage) return false

  logger.component('PageManager', 'isCurrentPage check', { currentUrl: currentPage.url, newUrl: url, match: currentPage.url === url })
  return currentPage.url === url
}

function findAndCreateComponent(url: string, index: number) {
  const path = url.split('?')[0].split('#')[0]
  logger.component('PageManager', 'findAndCreateComponent called', { url, path, routes: routes.length })
  
  for (const { matcher, element } of routes) {
    const match = matcher(path)
    logger.component('PageManager', 'Trying route matcher', { path, matchResult: !!match, matchParams: match ? (match as any).params : null })
    if (!match) continue

    if (!element) {
      logger.component('PageManager', 'No element for this route', { path })
      return {}
    }
    const ref = createRef<TPageRef>()
    
    // Decode URL parameters for relay pages
    const params = { ...(match as any).params }
    if (params.url && typeof params.url === 'string') {
      params.url = decodeURIComponent(params.url)
      logger.component('PageManager', 'Decoded URL parameter', { url: params.url })
    }
    
    logger.component('PageManager', 'Creating component with params', { params, index })
    try {
      const component = cloneElement(element, { ...params, index, ref } as any)
      logger.component('PageManager', 'Component created successfully', { hasComponent: !!component })
      return { component, ref }
    } catch (error) {
      logger.error('PageManager', 'Error creating component', { error, params })
      return {}
    }
  }
  logger.component('PageManager', 'No matching route found', { path, url })
  return {}
}

function pushNewPageToStack(
  stack: TStackItem[],
  url: string,
  maxStackSize = 5,
  specificIndex?: number
) {
  const currentItem = stack[stack.length - 1]
  const currentIndex = specificIndex ?? (currentItem ? currentItem.index + 1 : 0)

  const { component, ref } = findAndCreateComponent(url, currentIndex)
  if (!component) {
    logger.error('PageManager', 'pushNewPageToStack: No component created', { url, currentIndex, path: url.split('?')[0].split('#')[0] })
    return { newStack: stack, newItem: null }
  }

  const newItem = { component, ref, url, index: currentIndex }
  const newStack = [...stack, newItem]
  const lastCachedIndex = newStack.findIndex((stack) => stack.component)
  // Clear the oldest cached component if there are too many cached components
  if (newStack.length - lastCachedIndex > maxStackSize) {
    newStack[lastCachedIndex].component = null
  }
  logger.component('PageManager', 'pushNewPageToStack: Success', { url, newStackLength: newStack.length, newItemIndex: currentIndex })
  return { newStack, newItem }
}
