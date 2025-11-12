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
    if (isSmallScreen) {
      // Use primary note view on mobile
      // Extract note ID from URL (e.g., "/notes/note1..." -> "note1...")
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
  
  const setPrimaryNoteView = (view: ReactNode | null, type?: 'note' | 'settings' | 'settings-sub' | 'profile' | 'hashtag' | 'relay' | 'following' | 'mute' | 'others-relay-settings') => {
    if (view && !primaryNoteView) {
      // Saving current primary page before showing overlay
      setSavedPrimaryPage(currentPrimaryPage)
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
      // back to home page
      window.history.replaceState(null, '', '/')
      setSecondaryStack([])
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
