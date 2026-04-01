import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import logger from '@/lib/logger'
import { ChevronLeft } from 'lucide-react'
import { NavigationService } from '@/services/navigation.service'
// Page imports needed for primary note view
import LiveActivitiesStrip from '@/components/LiveActivitiesStrip'
import NoteDrawer from '@/components/NoteDrawer'
import storage from '@/services/local-storage.service'
import client from '@/services/client.service'
import { navigationEventStore } from '@/services/navigation-event-store'
import type { Event } from 'nostr-tools'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { CurrentRelaysProvider } from '@/providers/CurrentRelaysProvider'
// DEPRECATED: useUserPreferences removed - double-panel functionality disabled
import { TPageRef } from '@/types'
import {
  cloneElement,
  createRef,
  isValidElement,
  lazy,
  type ReactElement,
  type ReactNode,
  RefObject,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { KeyboardShortcutsHelpProvider } from '@/components/KeyboardShortcutsHelp'
import {
  PrimaryPageContext,
  usePrimaryPage,
  usePrimaryPageOptional,
  type PrimaryPageContextValue
} from '@/contexts/primary-page-context'
import { normalizeUrl } from './lib/url'
import modalManager from './services/modal-manager.service'
import { decodeRssArticlePathSegment, encodeRssArticlePathSegment } from '@/lib/rss-article'
import { routes } from './routes'
import { useScreenSize, useScreenSizeOptional } from './providers/ScreenSizeProvider'
import { NoteDrawerContext, useNoteDrawer, useNoteDrawerOptional } from '@/contexts/note-drawer-context'
import {
  PrimaryNoteViewContext,
  usePrimaryNoteView,
  usePrimaryNoteViewOptional,
  type TPrimaryOverlayViewType
} from '@/contexts/primary-note-view-context'
import { SecondaryPageContext, useSecondaryPage, useSecondaryPageOptional } from '@/contexts/secondary-page-context'

/** Lazy-loaded so PageManager does not synchronously import SpellsPage (avoids HMR cycle: SpellsPage → PrimaryPageLayout → PageManager → SpellsPage). */
const SpellsPageLazy = lazy(() => import('./pages/primary/SpellsPage'))
/** Lazy NoteList pages break: PageManager → … → NoteList → NoteCard → useSmartNoteNavigation → PageManager */
const NoteListPageLazy = lazy(() => import('@/pages/primary/NoteListPage'))
const SecondaryNoteListPageLazy = lazy(() => import('@/pages/secondary/NoteListPage'))

const primaryPageLazyFallback = (
  <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
    Loading…
  </div>
)

/** Lazy primary pages: each may import PrimaryPageLayout → usePrimaryPage → would sync-import PageManager. */
const ExplorePageLazy = lazy(() => import('./pages/primary/ExplorePage'))
const MePageLazy = lazy(() => import('./pages/primary/MePage'))
const ProfilePageLazy = lazy(() => import('./pages/primary/ProfilePage'))
const RelayPageLazy = lazy(() => import('./pages/primary/RelayPage'))
const SearchPageLazy = lazy(() => import('./pages/primary/SearchPage'))
const FollowsLatestPageLazy = lazy(() => import('./pages/primary/FollowsLatestPage'))
const RssPageLazy = lazy(() => import('./pages/primary/RssPage'))
const SettingsPrimaryPageLazy = lazy(() => import('./pages/primary/SettingsPrimaryPage'))

/** Lazy chrome: Sidebar / bottom bar / dialogs import hooks from PageManager — must not be sync-imported here. */
const SidebarLazy = lazy(() => import('@/components/Sidebar'))
const BottomNavigationBarLazy = lazy(() => import('@/components/BottomNavigationBar'))
const TooManyRelaysAlertDialogLazy = lazy(() => import('@/components/TooManyRelaysAlertDialog'))
const CreateWalletGuideToastLazy = lazy(() => import('@/components/CreateWalletGuideToast'))
const RelayPulseActiveNpubsSheetLazy = lazy(
  () => import('@/components/FavoriteRelaysActiveStrip/RelayPulseActiveNpubsSheet').then((m) => ({ default: m.RelayPulseActiveNpubsSheet }))
)

/** Mobile primary-note overlay: lazy so these pages are not in the main bundle (routes use the same modules → shared async chunks). */
const SecondaryProfilePageLazy = lazy(() => import('@/pages/secondary/ProfilePage'))
const PrimaryFollowingListPageLazy = lazy(() => import('@/pages/secondary/FollowingListPage'))
const PrimaryMuteListPageLazy = lazy(() => import('@/pages/secondary/MuteListPage'))
const PrimaryBookmarkListPageLazy = lazy(() => import('@/pages/secondary/BookmarkListPage'))
const PrimaryPinListPageLazy = lazy(() => import('@/pages/secondary/PinListPage'))
const PrimaryInterestListPageLazy = lazy(() => import('@/pages/secondary/InterestListPage'))
const PrimaryOthersRelaySettingsPageLazy = lazy(() => import('@/pages/secondary/OthersRelaySettingsPage'))
const SecondaryRelayPageLazy = lazy(() => import('@/pages/secondary/RelayPage'))

function suspensePrimaryPage(page: ReactElement) {
  return <Suspense fallback={primaryPageLazyFallback}>{page}</Suspense>
}

type TStackItem = {
  index: number
  url: string
  component: React.ReactElement | null
  ref: RefObject<TPageRef> | null
}

const PRIMARY_PAGE_REF_MAP = {
  explore: createRef<TPageRef>(),
  feed: createRef<TPageRef>(),
  me: createRef<TPageRef>(),
  profile: createRef<TPageRef>(),
  relay: createRef<TPageRef>(),
  search: createRef<TPageRef>(),
  'follows-latest': createRef<TPageRef>(),
  rss: createRef<TPageRef>(),
  settings: createRef<TPageRef>(),
  spells: createRef<TPageRef>()
}

// Lazy function to create PRIMARY_PAGE_MAP to avoid circular dependency
// This is only evaluated when called, not at module load time
const getPrimaryPageMap = () => ({
  explore: (
    <Suspense fallback={primaryPageLazyFallback}>
      <ExplorePageLazy ref={PRIMARY_PAGE_REF_MAP.explore} />
    </Suspense>
  ),
  feed: (
    <Suspense fallback={primaryPageLazyFallback}>
      <NoteListPageLazy ref={PRIMARY_PAGE_REF_MAP.feed} />
    </Suspense>
  ),
  me: (
    <Suspense fallback={primaryPageLazyFallback}>
      <MePageLazy ref={PRIMARY_PAGE_REF_MAP.me} />
    </Suspense>
  ),
  profile: (
    <Suspense fallback={primaryPageLazyFallback}>
      <ProfilePageLazy ref={PRIMARY_PAGE_REF_MAP.profile} />
    </Suspense>
  ),
  relay: (
    <Suspense fallback={primaryPageLazyFallback}>
      <RelayPageLazy ref={PRIMARY_PAGE_REF_MAP.relay} />
    </Suspense>
  ),
  search: (
    <Suspense fallback={primaryPageLazyFallback}>
      <SearchPageLazy ref={PRIMARY_PAGE_REF_MAP.search} />
    </Suspense>
  ),
  'follows-latest': (
    <Suspense fallback={primaryPageLazyFallback}>
      <FollowsLatestPageLazy ref={PRIMARY_PAGE_REF_MAP['follows-latest']} />
    </Suspense>
  ),
  rss: (
    <Suspense fallback={primaryPageLazyFallback}>
      <RssPageLazy ref={PRIMARY_PAGE_REF_MAP.rss} />
    </Suspense>
  ),
  settings: (
    <Suspense fallback={primaryPageLazyFallback}>
      <SettingsPrimaryPageLazy ref={PRIMARY_PAGE_REF_MAP.settings} />
    </Suspense>
  ),
  spells: (
    <Suspense fallback={primaryPageLazyFallback}>
      <SpellsPageLazy ref={PRIMARY_PAGE_REF_MAP.spells} />
    </Suspense>
  )
})

/** Spells is wrapped in `<Suspense>`; navigated props must go to the lazy page, not the boundary. */
function applyPrimaryPageProps(element: ReactNode, props: object): ReactNode {
  if (!isValidElement(element)) return element
  if (element.type === Suspense) {
    const inner = element.props.children
    if (isValidElement(inner)) {
      return cloneElement(element, undefined, cloneElement(inner, props))
    }
  }
  return cloneElement(element, props)
}

// Type for primary page names - use the return type of getPrimaryPageMap
export type TPrimaryPageName = keyof ReturnType<typeof getPrimaryPageMap>

type TPrimaryPageStateEntry = { name: TPrimaryPageName; element: ReactNode; props?: any }

function noteContextToPrimaryEntry(pageContext: string): { name: TPrimaryPageName; props?: object } | null {
  if (pageContext === 'discussions') {
    return { name: 'spells', props: { spell: 'discussions' } }
  }
  if (pageContext === 'explore' || pageContext === 'home') {
    return { name: 'explore' }
  }
  const map = getPrimaryPageMap()
  if (pageContext in map) {
    return { name: pageContext as TPrimaryPageName }
  }
  return null
}

function mergePrimaryPageEntry(
  prev: TPrimaryPageStateEntry[],
  entry: { name: TPrimaryPageName; props?: object }
): TPrimaryPageStateEntry[] {
  const map = getPrimaryPageMap()
  const element = map[entry.name]
  const exists = prev.find((p) => p.name === entry.name)
  if (exists) {
    if (entry.props) {
      exists.props = { ...(exists.props || {}), ...entry.props }
    }
    return [...prev]
  }
  return [...prev, { name: entry.name, element, props: entry.props }]
}

export { PrimaryPageContext, usePrimaryPage }

export { useSecondaryPage, useSecondaryPageOptional }

// Helper function to build contextual note URL
function buildNoteUrl(noteId: string, currentPage: TPrimaryPageName | null): string {
  // Pages that should preserve context in the URL
  const contextualPages: TPrimaryPageName[] = [
    'search',
    'profile',
    'feed',
    'spells',
    'rss',
    'explore',
    'follows-latest'
  ]

  if (currentPage && contextualPages.includes(currentPage)) {
    return `/${currentPage}/notes/${noteId}`
  }
  
  return `/notes/${noteId}`
}

function buildRssArticleUrl(
  articleUrl: string,
  currentPage: TPrimaryPageName | null,
  options?: { rssFeedReadOnly?: boolean }
): string {
  const key = encodeRssArticlePathSegment(articleUrl)
  const contextualPages: TPrimaryPageName[] = [
    'search',
    'profile',
    'feed',
    'spells',
    'rss',
    'explore',
    'follows-latest'
  ]
  let path =
    currentPage && contextualPages.includes(currentPage)
      ? `/${currentPage}/rss-item/${key}`
      : `/rss-item/${key}`
  if (options?.rssFeedReadOnly) {
    path += `${path.includes('?') ? '&' : '?'}rssFeedReadOnly=1`
  }
  return path
}

/** True for secondary routes that show an RSS / web article in the panel (contextual or bare). */
function replaceHistoryWithPrimaryPageUrl(
  page: TPrimaryPageName,
  props?: { spell?: string } | Record<string, unknown> | null
) {
  const pageUrl = buildPrimaryPageUrl(page, props as { spell?: string } | undefined)
  window.history.replaceState(null, '', pageUrl)
}

/** Open an RSS article in the secondary panel (same routing pattern as contextual note URLs). */
export function useSmartRssArticleNavigation() {
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { current: currentPrimaryPage } = usePrimaryPage()

  const navigateToRssArticle = (
    articleUrl: string,
    navOptions?: { rssFeedReadOnly?: boolean }
  ) => {
    pushSecondaryPage(buildRssArticleUrl(articleUrl, currentPrimaryPage, navOptions))
  }

  return { navigateToRssArticle }
}

// Helper function to build contextual relay URL
function buildRelayUrl(relayUrl: string, currentPage: TPrimaryPageName | null): string {
  const encodedRelayUrl = encodeURIComponent(relayUrl)
  
  if (currentPage === 'explore') {
    return `/explore/relays/${encodedRelayUrl}`
  }
  
  return `/relays/${encodedRelayUrl}`
}

/** Path (+ query for spells) pushed when navigating primary pages — shareable URLs for faux spells. */
function buildPrimaryPageUrl(
  page: TPrimaryPageName,
  props?: { spell?: string } | Record<string, unknown> | null
): string {
  if (page === 'feed') return '/'
  if (page === 'explore') return '/explore'
  if (page === 'spells') {
    const spell =
      props && typeof (props as { spell?: unknown }).spell === 'string'
        ? String((props as { spell: string }).spell).trim()
        : ''
    if (spell) return `/spells?spell=${encodeURIComponent(spell)}`
    return '/spells'
  }
  return `/${page}`
}

function spellPropsFromSearch(search: string): { spell: string } | undefined {
  const spell = new URLSearchParams(search).get('spell')?.trim()
  return spell ? { spell } : undefined
}

/** Primary URL for drawer/overlay restore when we only have pathname + optional full URL for query. */
function restoredPrimaryBrowserUrl(pathname: string, fullUrlForQuery: string): string {
  const popSegments = pathname.split('/').filter(Boolean)
  const popFirstSeg = popSegments[0] ?? ''
  if (popSegments.length === 0) {
    return '/'
  }
  if (popSegments.length === 1 && popFirstSeg === 'home') {
    return '/explore'
  }
  if (popSegments.length === 1 && popFirstSeg === 'spells') {
    try {
      const sp = new URL(fullUrlForQuery, window.location.origin).searchParams.get('spell')?.trim()
      return buildPrimaryPageUrl('spells', sp ? { spell: sp } : undefined)
    } catch {
      return '/spells'
    }
  }
  if (popSegments.length === 1) return `/${popFirstSeg}`
  return pathname
}

// Helper function to extract noteId and context from URL
function extractValidNoteId(raw: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw).trim()
    } catch {
      return raw.trim()
    }
  })()
  const withoutPrefix = decoded.startsWith('nostr:') ? decoded.slice(6) : decoded
  if (/^[0-9a-f]{64}$/i.test(withoutPrefix)) return withoutPrefix.toLowerCase()
  const lower = withoutPrefix.toLowerCase()
  if (
    lower.startsWith('note1') ||
    lower.startsWith('nevent1') ||
    lower.startsWith('naddr1')
  ) {
    return withoutPrefix
  }
  return null
}

function parseNoteUrl(url: string): { noteId: string; context?: string } | null {
  // Match patterns like /discussions/notes/{noteId} or /notes/{noteId}
  const contextualMatch = url.match(
    /\/(discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/notes\/(.+)$/
  )
  if (contextualMatch) {
    const noteId = extractValidNoteId(contextualMatch[2])
    if (!noteId) return null
    return { noteId, context: contextualMatch[1] }
  }
  
  // Match standard pattern /notes/{noteId}
  const standardMatch = url.match(/\/notes\/(.+)$/)
  if (standardMatch) {
    const noteId = extractValidNoteId(standardMatch[1])
    if (!noteId) return null
    return { noteId }
  }
  
  return null
}

// Fixed: Note navigation uses drawer on mobile/single-pane, secondary panel on double-pane desktop
export function useSmartNoteNavigation() {
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { openDrawer } = useNoteDrawer()
  const { isSmallScreen } = useScreenSize()
  const { current: currentPrimaryPage } = usePrimaryPage()
  
  const navigateToNote = (url: string, event?: Event, relatedEvents?: Event[]) => {
    // Extract noteId from URL (handles both /notes/{id} and /{context}/notes/{id})
    const parsed = parseNoteUrl(url)
    if (!parsed) {
      logger.warn('navigateToNote ignored invalid note URL', { url })
      return
    }
    const { noteId } = parsed
    
    // If event is provided, store it in navigation event store to avoid re-fetching
    if (event) {
      navigationEventStore.setEvent(event)
      client.addEventToCache(event)
    }
    // Pre-cache related events (parent, root, embedded) so NotePage avoids re-fetching
    if (relatedEvents?.length) {
      for (const ev of relatedEvents) {
        if (ev && ev !== event) client.addEventToCache(ev)
      }
    }
    
    // Build contextual URL based on current page
    const contextualUrl = buildNoteUrl(noteId, currentPrimaryPage)
    
    if (isSmallScreen) {
      // Mobile: always push to secondary stack AND update drawer
      // This ensures back button works when clicking embedded events
      pushSecondaryPage(contextualUrl)
      openDrawer(noteId, event)
    } else {
      // Desktop: check panel mode
      const currentPanelMode = storage.getPanelMode()
      if (currentPanelMode === 'single') {
        // Always push so the secondary stack matches the drawer; otherwise the first note is not on
        // the stack and Back after opening a quote only closes the drawer instead of the parent note.
        pushSecondaryPage(contextualUrl)
        openDrawer(noteId, event)
      } else {
        // Double-pane: use secondary panel
        pushSecondaryPage(contextualUrl)
      }
    }
  }
  
  return { navigateToNote }
}

/** Safe variant for createRoot trees (e.g. AsciidocArticle embedded notes). Returns no-op navigation when outside providers. */
export function useSmartNoteNavigationOptional() {
  const pushSecondaryPage = useSecondaryPageOptional()
  const noteDrawer = useNoteDrawerOptional()
  const screenSize = useScreenSizeOptional()
  const primaryPage = usePrimaryPageOptional()

  if (!pushSecondaryPage || !noteDrawer || !screenSize || !primaryPage) {
    return {
      navigateToNote: (url: string, _event?: Event, _relatedEvents?: Event[]) => {
        window.location.href = url
      }
    }
  }

  const { push } = pushSecondaryPage
  const { openDrawer } = noteDrawer
  const { isSmallScreen } = screenSize
  const { current: currentPrimaryPage } = primaryPage

  const navigateToNote = (url: string, event?: Event, relatedEvents?: Event[]) => {
    const parsed = parseNoteUrl(url)
    if (!parsed) {
      logger.warn('navigateToNote (optional) ignored invalid note URL', { url })
      return
    }
    const { noteId } = parsed
    if (event) {
      navigationEventStore.setEvent(event)
      client.addEventToCache(event)
    }
    if (relatedEvents?.length) {
      for (const ev of relatedEvents) {
        if (ev && ev !== event) client.addEventToCache(ev)
      }
    }
    const contextualUrl = buildNoteUrl(noteId, currentPrimaryPage)
    if (isSmallScreen) {
      push(contextualUrl)
      openDrawer(noteId, event)
    } else {
      const currentPanelMode = storage.getPanelMode()
      if (currentPanelMode === 'single') {
        push(contextualUrl)
        openDrawer(noteId, event)
      } else {
        push(contextualUrl)
      }
    }
  }
  return { navigateToNote }
}

// Fixed: Relay navigation now uses primary note view on mobile, secondary routing (drawer in single-pane, side panel in double-pane) on desktop
export function useSmartRelayNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  const { current: currentPrimaryPage } = usePrimaryPage()
  
  const navigateToRelay = (url: string) => {
    // Extract relay URL from path (handles both /relays/{url} and /{context}/relays/{url})
    const relayUrlMatch =
      url.match(
        /\/(discussions|search|profile|home|feed|spells|explore|follows-latest)\/relays\/(.+)$/
      ) ||
      url.match(/\/relays\/(.+)$/)
    const relayUrl = relayUrlMatch ? decodeURIComponent(relayUrlMatch[relayUrlMatch.length - 1]) : decodeURIComponent(url.replace(/.*\/relays\//, ''))
    
    // Build contextual URL based on current page
    const contextualUrl = buildRelayUrl(relayUrl, currentPrimaryPage)
    
    if (isSmallScreen) {
      // Use primary note view on mobile
      window.history.pushState(null, '', contextualUrl)
      setPrimaryNoteView(
        suspensePrimaryPage(<SecondaryRelayPageLazy url={relayUrl} index={0} hideTitlebar={true} />),
        'relay'
      )
    } else {
      // Desktop: always use secondary routing (will be rendered in drawer in single-pane, side panel in double-pane)
      pushSecondaryPage(contextualUrl)
    }
  }
  
  return { navigateToRelay }
}

/** Safe variant for createRoot trees. Returns fallback navigation when outside providers. */
export function useSmartRelayNavigationOptional() {
  const primaryNoteView = usePrimaryNoteViewOptional()
  const secondaryPage = useSecondaryPageOptional()
  const screenSize = useScreenSizeOptional()
  const primaryPage = usePrimaryPageOptional()
  if (!primaryNoteView || !secondaryPage || !screenSize || !primaryPage) {
    return { navigateToRelay: (url: string) => { window.location.href = url } }
  }
  const { setPrimaryNoteView } = primaryNoteView
  const { push: pushSecondaryPage } = secondaryPage
  const { isSmallScreen } = screenSize
  const { current: currentPrimaryPage } = primaryPage
  const navigateToRelay = (url: string) => {
    const relayUrlMatch =
      url.match(
        /\/(discussions|search|profile|home|feed|spells|explore|follows-latest)\/relays\/(.+)$/
      ) ||
      url.match(/\/relays\/(.+)$/)
    const relayUrl = relayUrlMatch ? decodeURIComponent(relayUrlMatch[relayUrlMatch.length - 1]) : decodeURIComponent(url.replace(/.*\/relays\//, ''))
    const contextualUrl = buildRelayUrl(relayUrl, currentPrimaryPage)
    if (isSmallScreen) {
      window.history.pushState(null, '', contextualUrl)
      setPrimaryNoteView(
        suspensePrimaryPage(<SecondaryRelayPageLazy url={relayUrl} index={0} hideTitlebar={true} />),
        'relay'
      )
    } else {
      pushSecondaryPage(contextualUrl)
    }
  }
  return { navigateToRelay }
}

// Fixed: Profile navigation now uses primary note view on mobile, secondary routing on desktop
export function useSmartProfileNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  const { closeDrawer, isDrawerOpen } = useNoteDrawer()
  
  const navigateToProfile = (url: string) => {
    // Close drawer if open (profiles aren't shown in drawers)
    // Navigate after drawer closes to avoid URL being restored by drawer's onOpenChange
    if (isDrawerOpen) {
      closeDrawer()
      // Wait for drawer to close (350ms animation) before navigating
      setTimeout(() => {
        if (isSmallScreen) {
          // Use primary note view on mobile
          const profileId = url.replace('/users/', '')
          window.history.pushState(null, '', url)
          setPrimaryNoteView(
            suspensePrimaryPage(<SecondaryProfilePageLazy id={profileId} index={0} hideTitlebar={true} />),
            'profile'
          )
        } else {
          // Use secondary routing on desktop
          pushSecondaryPage(url)
        }
      }, 400) // Slightly longer than drawer close animation (350ms)
    } else {
      // No drawer open, navigate immediately
      if (isSmallScreen) {
        // Use primary note view on mobile
        const profileId = url.replace('/users/', '')
        window.history.pushState(null, '', url)
        setPrimaryNoteView(
          suspensePrimaryPage(<SecondaryProfilePageLazy id={profileId} index={0} hideTitlebar={true} />),
          'profile'
        )
      } else {
        // Use secondary routing on desktop
        pushSecondaryPage(url)
      }
    }
  }
  
  return { navigateToProfile }
}

/** Safe variant for createRoot trees (e.g. AsciidocArticle embedded mentions). Returns fallback navigation when outside providers. */
export function useSmartProfileNavigationOptional() {
  const primaryNoteView = usePrimaryNoteViewOptional()
  const secondaryPage = useSecondaryPageOptional()
  const screenSize = useScreenSizeOptional()
  const noteDrawer = useNoteDrawerOptional()

  if (!primaryNoteView || !secondaryPage || !screenSize || !noteDrawer) {
    return {
      navigateToProfile: (url: string) => {
        window.location.href = url
      }
    }
  }

  const { setPrimaryNoteView } = primaryNoteView
  const { push: pushSecondaryPage } = secondaryPage
  const { isSmallScreen } = screenSize
  const { closeDrawer, isDrawerOpen } = noteDrawer

  const navigateToProfile = (url: string) => {
    if (isDrawerOpen) {
      closeDrawer()
      setTimeout(() => {
        if (isSmallScreen) {
          const profileId = url.replace('/users/', '')
          window.history.pushState(null, '', url)
          setPrimaryNoteView(
            suspensePrimaryPage(<SecondaryProfilePageLazy id={profileId} index={0} hideTitlebar={true} />),
            'profile'
          )
        } else {
          pushSecondaryPage(url)
        }
      }, 400)
    } else {
      if (isSmallScreen) {
        const profileId = url.replace('/users/', '')
        window.history.pushState(null, '', url)
        setPrimaryNoteView(
          suspensePrimaryPage(<SecondaryProfilePageLazy id={profileId} index={0} hideTitlebar={true} />),
          'profile'
        )
      } else {
        pushSecondaryPage(url)
      }
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
    setPrimaryNoteView(
      <Suspense fallback={primaryPageLazyFallback}>
        <SecondaryNoteListPageLazy key={key} hideTitlebar={true} />
      </Suspense>,
      'hashtag'
    )
    // Dispatch custom event as a fallback for components that might be reused
    window.dispatchEvent(new CustomEvent('hashtag-navigation', { detail: { url: parsedUrl } }))
  }
  
  return { navigateToHashtag }
}

/** Safe variant for createRoot trees. Returns fallback navigation when outside providers. */
export function useSmartHashtagNavigationOptional() {
  const primaryNoteView = usePrimaryNoteViewOptional()
  if (!primaryNoteView) {
    return { navigateToHashtag: (url: string) => { window.location.href = url.startsWith('/') ? url : `/${url}` } }
  }
  const { setPrimaryNoteView, getNavigationCounter } = primaryNoteView
  const navigateToHashtag = (url: string) => {
    const parsedUrl = url.startsWith('/') ? url : `/${url}`
    window.history.pushState(null, '', parsedUrl)
    const searchParams = new URLSearchParams(parsedUrl.includes('?') ? parsedUrl.split('?')[1] : '')
    const hashtag = searchParams.get('t') || ''
    const counter = getNavigationCounter()
    const key = `hashtag-${hashtag}-${counter + 1}`
    setPrimaryNoteView(
      <Suspense fallback={primaryPageLazyFallback}>
        <SecondaryNoteListPageLazy key={key} hideTitlebar={true} />
      </Suspense>,
      'hashtag'
    )
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
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryFollowingListPageLazy id={profileId} index={0} hideTitlebar={true} />),
        'following'
      )
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
      setPrimaryNoteView(suspensePrimaryPage(<PrimaryMuteListPageLazy index={0} hideTitlebar={true} />), 'mute')
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToMuteList }
}

export function useSmartBookmarkListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToBookmarkList = (url: string) => {
    if (isSmallScreen) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryBookmarkListPageLazy index={0} hideTitlebar={true} />),
        'bookmarks'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToBookmarkList }
}

export function useSmartPinListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToPinList = (url: string) => {
    if (isSmallScreen) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryPinListPageLazy index={0} hideTitlebar={true} />),
        'pins'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToPinList }
}

export function useSmartInterestListNavigation() {
  const { setPrimaryNoteView } = usePrimaryNoteView()
  const { push: pushSecondaryPage } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()

  const navigateToInterestList = (url: string) => {
    if (isSmallScreen) {
      window.history.pushState(null, '', url)
      setPrimaryNoteView(
        suspensePrimaryPage(<PrimaryInterestListPageLazy index={0} hideTitlebar={true} />),
        'interests'
      )
    } else {
      pushSecondaryPage(url)
    }
  }

  return { navigateToInterestList }
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
      setPrimaryNoteView(
        suspensePrimaryPage(
          <PrimaryOthersRelaySettingsPageLazy id={profileId} index={0} hideTitlebar={true} />
        ),
        'others-relay-settings'
      )
    } else {
      // Use secondary routing on desktop
      pushSecondaryPage(url)
    }
  }
  
  return { navigateToOthersRelaySettings }
}

/** Settings index is a normal primary page; sub-routes open on the secondary stack (panel / drawer). */
export function useSmartSettingsNavigation() {
  const { navigate: navigatePrimary } = usePrimaryPage()
  const { push: pushSecondaryPage } = useSecondaryPage()

  const navigateToSettings = (url: string) => {
    const base = url.split('?')[0].split('#')[0]
    if (base === '/settings') {
      navigatePrimary('settings')
      return
    }
    pushSecondaryPage(url)
  }

  return { navigateToSettings }
}

// DEPRECATED: ConditionalHomePage removed - double-panel functionality disabled

// Helper function to get page title based on view type and URL
function getPageTitle(viewType: TPrimaryOverlayViewType | null, pathname: string): string {
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
  goBack,
  onPrimaryPanelRefresh
}: {
  primaryPages: { name: TPrimaryPageName; element: ReactNode; props?: any }[]
  currentPrimaryPage: TPrimaryPageName
  primaryNoteView: ReactNode | null
  primaryViewType: TPrimaryOverlayViewType | null
  goBack: () => void
  onPrimaryPanelRefresh: () => void
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
  
  // flex + min-h-0 + min-w-0 so primary pages get a real height in flex parents and can shrink horizontally (double-pane).
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col w-full pr-2 py-2">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-background shadow-lg">
        {primaryNoteView ? (
          // Show note view with back button
          <div className="flex h-full min-h-0 min-w-0 w-full flex-col">
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
              <div className="flex flex-1 w-0 justify-end pr-1">
                <RefreshButton onClick={onPrimaryPanelRefresh} />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
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
                className={cn(
                  'flex h-full min-h-0 w-full min-w-0 flex-col',
                  isCurrentPage ? 'flex' : 'hidden'
                )}
              >
                {(() => {
                  try {
                    logger.debug(`Rendering ${name} component`)
                    return props ? applyPrimaryPageProps(element, props) : element
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
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  // DEPRECATED: showRecommendedRelaysPanel removed - double-panel functionality disabled
  const [currentPrimaryPage, setCurrentPrimaryPage] = useState<TPrimaryPageName>('feed')
  const [primaryPages, setPrimaryPages] = useState<
    { name: TPrimaryPageName; element: ReactNode; props?: any }[]
  >([
    {
      name: 'feed',
      element: getPrimaryPageMap().feed
    }
  ])
  const [secondaryStack, setSecondaryStack] = useState<TStackItem[]>([])
  /** Latest stack for popstate / pop() — avoids stale length when history and React state race. */
  const secondaryStackRef = useRef<TStackItem[]>([])
  useLayoutEffect(() => {
    secondaryStackRef.current = secondaryStack
  }, [secondaryStack])
  const [primaryNoteView, setPrimaryNoteViewState] = useState<ReactNode | null>(null)
  const [primaryViewType, setPrimaryViewType] = useState<TPrimaryOverlayViewType | null>(null)
  const [savedPrimaryPage, setSavedPrimaryPage] = useState<TPrimaryPageName | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerNoteId, setDrawerNoteId] = useState<string | null>(null)
  const [singlePaneSheetOpen, setSinglePaneSheetOpen] = useState(false)
  const [panelMode, setPanelMode] = useState<'single' | 'double'>(() => storage.getPanelMode())
  /** Latest primary page for async callbacks (drawer-close timer) without resubscribing effects on every primary change. */
  const currentPrimaryPageRef = useRef<TPrimaryPageName>(currentPrimaryPage)
  useLayoutEffect(() => {
    currentPrimaryPageRef.current = currentPrimaryPage
  }, [currentPrimaryPage])
  const navigationCounterRef = useRef(0)
  const primaryPanelRefreshRef = useRef<(() => void) | null>(null)
  const registerPrimaryPanelRefresh = useCallback((fn: (() => void) | null) => {
    primaryPanelRefreshRef.current = fn
  }, [])
  const triggerPrimaryPanelRefresh = useCallback(() => {
    primaryPanelRefreshRef.current?.()
  }, [])
  const savedFeedStateRef = useRef<Map<TPrimaryPageName, { tab?: string }>>(new Map())
  const currentTabStateRef = useRef<Map<TPrimaryPageName, string>>(new Map()) // Track current tab state for each page
  const savedPrimaryPagePropsRef = useRef<object | undefined>(undefined)
  const primaryPagePropsRef = useRef<Map<TPrimaryPageName, object | undefined>>(new Map())

  const currentPageProps = useMemo((): object | undefined => {
    const entry = primaryPages.find((p) => p.name === currentPrimaryPage)
    return entry?.props as object | undefined
  }, [primaryPages, currentPrimaryPage])

  /** Keeps spell query (?spell=) and other primary props for URL restore after drawer/popstate — refs were never written before. */
  useEffect(() => {
    const m = primaryPagePropsRef.current
    for (const p of primaryPages) {
      m.set(p.name, p.props)
    }
  }, [primaryPages])

  const setPrimaryNoteView = (view: ReactNode | null, type?: TPrimaryOverlayViewType) => {
    if (view && !primaryNoteView) {
      // Saving current primary page before showing overlay
      savedPrimaryPagePropsRef.current = primaryPages.find((p) => p.name === currentPrimaryPage)?.props as
        | object
        | undefined
      setSavedPrimaryPage(currentPrimaryPage)
      
      // Get current tab state from ref (updated by components via events)
      const currentTab = currentTabStateRef.current.get(currentPrimaryPage)

      if (currentTab) {
        logger.info('PageManager: Saving page state', {
          page: currentPrimaryPage,
          tab: currentTab
        })
        savedFeedStateRef.current.set(currentPrimaryPage, {
          tab: currentTab
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
      const newUrl = buildPrimaryPageUrl(
        savedPrimaryPage,
        savedPrimaryPagePropsRef.current as { spell?: string } | undefined
      )
      window.history.replaceState(null, '', newUrl)
      
      const savedFeedState = savedFeedStateRef.current.get(savedPrimaryPage)
      
      // Restore tab state first
      if (savedFeedState?.tab) {
        logger.info('PageManager: Restoring tab state', { page: savedPrimaryPage, tab: savedFeedState.tab })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: savedPrimaryPage, tab: savedFeedState.tab } 
        }))
        currentTabStateRef.current.set(savedPrimaryPage, savedFeedState.tab)
      }
    }
  }

  // Drawer handlers
  const [drawerInitialEvent, setDrawerInitialEvent] = useState<Event | null>(null)
  const openDrawer = useCallback((noteId: string, initialEvent?: Event) => {
    setDrawerNoteId(noteId)
    setDrawerInitialEvent(initialEvent ?? null)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    if (!drawerOpen) return // Already closed
    setDrawerOpen(false)
    // Don't clear noteId here — scheduled in the drawer-close effect after the sheet animation.
  }, [drawerOpen])
  const ignorePopStateRef = useRef(false)
  /** Avoid duplicating history entries when drawer/mode deps re-run the PageManager effect. */
  const historySeedDoneRef = useRef(false)
  /** When set before closing the note drawer, replaceState uses this URL instead of buildPrimaryPageUrl (popstate edge cases). */
  const pendingDrawerCloseUrlRef = useRef<string | null>(null)

  useEffect(() => {
    const useDrawer = isSmallScreen || panelMode === 'single'
    if (!useDrawer || drawerOpen || !drawerNoteId) return

    const timer = window.setTimeout(() => {
      const pending = pendingDrawerCloseUrlRef.current
      pendingDrawerCloseUrlRef.current = null
      if (pending) {
        window.history.replaceState(null, '', pending)
      } else {
        const page = currentPrimaryPageRef.current
        replaceHistoryWithPrimaryPageUrl(
          page,
          primaryPagePropsRef.current.get(page) as { spell?: string } | undefined
        )
      }
      setDrawerNoteId(null)
      setDrawerInitialEvent(null)
    }, 350)

    return () => {
      window.clearTimeout(timer)
      pendingDrawerCloseUrlRef.current = null
    }
  }, [drawerOpen, drawerNoteId, isSmallScreen, panelMode])

  // Handle browser back button for primary note view
  useEffect(() => {
    const handlePopState = () => {
      if (ignorePopStateRef.current) {
        ignorePopStateRef.current = false
        return
      }
      
      // If we have a primary note view open (and drawer is not open), close it
      if (primaryNoteView && !drawerOpen) {
        setPrimaryNoteView(null)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [primaryNoteView, drawerOpen])

  useEffect(() => {
    if (!historySeedDoneRef.current) {
      historySeedDoneRef.current = true
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
    // OG HTML proxy (`VITE_PROXY_SERVER`, e.g. https://host/proxy) must be reverse-proxied to the
    // fetch service. If /proxy is routed to this SPA, normalize to / so we don't push an unknown URL.
    {
      const proxyPath = window.location.pathname.split('?')[0].split('#')[0]
      if (proxyPath === '/proxy' || proxyPath.startsWith('/proxy/')) {
        window.history.replaceState(null, '', '/')
      }
    }
    window.history.pushState(null, '', window.location.href)
    if (window.location.pathname !== '/') {
      const url = window.location.pathname + window.location.search + window.location.hash
      const pathname = window.location.pathname
      
      // Check if this is a note URL - handle both /notes/{id} and /{context}/notes/{id}
      const contextualNoteMatch = pathname.match(/\/(discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/notes\/(.+)$/)
      const standardNoteMatch = pathname.match(/\/notes\/(.+)$/)
      const noteUrlMatch = contextualNoteMatch || standardNoteMatch
      
      if (noteUrlMatch) {
        const noteId = noteUrlMatch[noteUrlMatch.length - 1].split('?')[0].split('#')[0]
        if (noteId) {
          let primaryForNoteUrl: TPrimaryPageName = currentPrimaryPage

          const pushNoteUrlOnStack = (noteUrl: string) => {
            setSecondaryStack((prevStack) => {
              if (isCurrentPage(prevStack, noteUrl)) return prevStack
              const { newStack, newItem } = pushNewPageToStack(prevStack, noteUrl, maxStackSize)
              if (newItem) {
                window.history.replaceState({ index: newItem.index, url: noteUrl }, '', noteUrl)
              }
              return newStack
            })
          }

          // If this is a contextual note URL, set the primary page first
          if (contextualNoteMatch) {
            const pageContext = contextualNoteMatch[1]
            const resolved = noteContextToPrimaryEntry(pageContext)
            if (resolved) {
              primaryForNoteUrl = resolved.name
              // Open drawer immediately, then load background page asynchronously
              // This prevents the background page loading from blocking the drawer
              if (isSmallScreen || panelMode === 'single') {
                // Seed stack so in-drawer navigation (e.g. quotes → back) can pop to this note
                pushNoteUrlOnStack(buildNoteUrl(noteId, resolved.name))
                openDrawer(noteId)

                setTimeout(() => {
                  setCurrentPrimaryPage(resolved.name)
                  setPrimaryPages((prev) => mergePrimaryPageEntry(prev, resolved))
                  setSavedPrimaryPage(resolved.name)
                }, 0)
                return
              } else {
                // Double-pane mode: set page immediately (no drawer)
                setCurrentPrimaryPage(resolved.name)
                setPrimaryPages((prev) => mergePrimaryPageEntry(prev, resolved))
                setSavedPrimaryPage(resolved.name)
              }
            }
          }

          const contextualUrl = buildNoteUrl(noteId, primaryForNoteUrl)

          if (isSmallScreen || panelMode === 'single') {
            pushNoteUrlOnStack(contextualUrl)
            openDrawer(noteId)
            return
          } else {
            pushNoteUrlOnStack(contextualUrl)
            return
          }
        }
      }

      // RSS article in side panel: /{context}/rss-item/{key} or /rss-item/{key}
      const contextualRssMatch = pathname.match(
        /^\/(discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/rss-item\/([^/?#]+)/
      )
      const standardRssMatch = pathname.match(/^\/rss-item\/([^/?#]+)/)
      const rssArticleKey = contextualRssMatch?.[2] ?? standardRssMatch?.[1]
      if (rssArticleKey) {
        let decodedArticleUrl = ''
        try {
          decodedArticleUrl = decodeRssArticlePathSegment(rssArticleKey)
        } catch {
          decodedArticleUrl = ''
        }
        if (decodedArticleUrl) {
          const resolvedRss = contextualRssMatch
            ? noteContextToPrimaryEntry(contextualRssMatch[1])
            : null
          const rssPrimaryEntry: { name: TPrimaryPageName; props?: object } = resolvedRss ?? {
            name: 'rss'
          }

          const applyRssPrimary = () => {
            setCurrentPrimaryPage(rssPrimaryEntry.name)
            setPrimaryPages((prev) => mergePrimaryPageEntry(prev, rssPrimaryEntry))
            setSavedPrimaryPage(rssPrimaryEntry.name)
          }

          if (isSmallScreen || panelMode === 'single') {
            setTimeout(applyRssPrimary, 0)
          } else {
            applyRssPrimary()
          }

          const contextualRssUrl = buildRssArticleUrl(decodedArticleUrl, rssPrimaryEntry.name)

          setSecondaryStack((prevStack) => {
            if (isCurrentPage(prevStack, contextualRssUrl)) return prevStack

            const { newStack, newItem } = pushNewPageToStack(prevStack, contextualRssUrl, maxStackSize)
            if (newItem) {
              window.history.replaceState({ index: newItem.index, url: contextualRssUrl }, '', contextualRssUrl)
            }
            return newStack
          })
          return
        }
      }

      // Check if this is a primary page URL - don't push primary pages to secondary stack
      const pathnameOnly = pathname.split('?')[0].split('#')[0]
      const segments = pathnameOnly.split('/').filter(Boolean)
      const firstSeg = segments[0] ?? ''
      const primaryMap = getPrimaryPageMap()
      const isPrimaryPageUrl =
        segments.length === 0 ||
        (segments.length === 1 &&
          (firstSeg === 'discussions' ||
            firstSeg === 'home' ||
            firstSeg === 'explore' ||
            firstSeg in primaryMap))

      if (isPrimaryPageUrl) {
        // This is a primary page - just navigate to it, don't push to secondary stack
        const pageName: TPrimaryPageName | 'discussions' | null =
          segments.length === 0
            ? 'feed'
            : firstSeg === 'home'
              ? 'explore'
              : firstSeg === 'discussions'
                ? 'discussions'
                : firstSeg in primaryMap
                  ? (firstSeg as TPrimaryPageName)
                  : null
        if (pageName === 'explore') {
          navigatePrimaryPage('explore')
          requestAnimationFrame(() => {
            window.dispatchEvent(
              new CustomEvent('restorePageTab', { detail: { page: 'explore', tab: 'explore' } })
            )
          })
        } else if (pageName === 'discussions') {
          navigatePrimaryPage('spells', { spell: 'discussions' })
        } else if (pageName === 'spells') {
          const spellProps = spellPropsFromSearch(window.location.search)
          navigatePrimaryPage('spells', spellProps)
        } else if (pageName && pageName in primaryMap) {
          navigatePrimaryPage(pageName as TPrimaryPageName)
        }
        return
      }
      
      // For relay URLs and other non-note URLs, push to secondary stack
      // (will be rendered in drawer in single-pane mode, side panel in double-pane mode)
      setSecondaryStack((prevStack) => {
        if (isCurrentPage(prevStack, url)) return prevStack

        const { newStack, newItem } = pushNewPageToStack(prevStack, url, maxStackSize)
        if (newItem) {
          window.history.replaceState({ index: newItem.index, url }, '', url)
        }
        return newStack
      })
    } else {
      // Check for relay URL in query params (legacy support)
      const searchParams = new URLSearchParams(window.location.search)
      const r = searchParams.get('r')
      
      if (r) {
        const url = normalizeUrl(r)
        if (url) {
          navigatePrimaryPage('relay', { url })
          return
        }
      }
      
      // Parse pathname to determine primary page
      const pathname: string = window.location.pathname
      
      // Handle dedicated paths for primary pages
      if (pathname === '/') {
        navigatePrimaryPage('feed')
      } else if (pathname === '/home') {
        navigatePrimaryPage('explore')
      } else {
        // Check if pathname matches a primary page name
        // First, check if it's a contextual note URL (e.g., /discussions/notes/...)
        const contextualNoteMatch = pathname.match(
          /^\/(discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/notes\//
        )
        if (contextualNoteMatch) {
          const pageContext = contextualNoteMatch[1]
          const resolved = noteContextToPrimaryEntry(pageContext)
          if (resolved) {
            navigatePrimaryPage(resolved.name, resolved.props)
            // The note URL will be handled by the note URL parsing above
          }
          return
        }

        // Check if it's a standard primary page path
        const pageName: string = pathname.slice(1).split('/')[0] // Get first segment after slash
        if (pageName === 'discussions') {
          navigatePrimaryPage('spells', { spell: 'discussions' })
          return
        }
        if (pageName === 'explore') {
          navigatePrimaryPage('explore')
          requestAnimationFrame(() => {
            window.dispatchEvent(
              new CustomEvent('restorePageTab', { detail: { page: 'explore', tab: 'explore' } })
            )
          })
          return
        }
        if (pageName === 'spells') {
          const spellProps = spellPropsFromSearch(window.location.search)
          navigatePrimaryPage('spells', spellProps)
          return
        }
        if (pageName && pageName in getPrimaryPageMap()) {
          // For relay page, check if there's a URL prop
          if (pageName === 'relay') {
            // Relay URLs are handled via secondary routing, not primary pages
            // This should be caught earlier in the URL parsing
          } else {
            navigatePrimaryPage(pageName as TPrimaryPageName)
          }
        }
        // If pathname doesn't match a primary page, it might be a secondary route
        // which is handled elsewhere
      }
    }
    }

    const onPopState = (e: PopStateEvent) => {
      if (ignorePopStateRef.current) {
        ignorePopStateRef.current = false
        return
      }

      // If the side panel has frames, this popstate is almost certainly stack navigation — do not let
      // modalManager steal it (history.forward + return), which leaves the URL changed and the panel stale.
      if (secondaryStackRef.current.length === 0) {
        const closeModal = modalManager.pop()
        if (closeModal) {
          ignorePopStateRef.current = true
          window.history.forward()
          return
        }
      }

      let state = e.state as { index: number; url: string } | null
      
      // Use state.url if available, otherwise fall back to current pathname
      const urlToCheck = state?.url || window.location.pathname
      
      // Check if it's a note URL (we'll update drawer after stack is synced)
      const noteUrlMatch = urlToCheck.match(/\/(discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/notes\/(.+)$/) || 
                          urlToCheck.match(/\/notes\/(.+)$/)
      const noteIdToShow = noteUrlMatch ? noteUrlMatch[noteUrlMatch.length - 1].split('?')[0].split('#')[0] : null

      // Keep spells faux spell in sync with ?spell= on browser back/forward
      if (!noteIdToShow) {
        const syncSegs = window.location.pathname.split('/').filter(Boolean)
        if (syncSegs.length === 1 && syncSegs[0] === 'spells') {
          const spellProps = spellPropsFromSearch(window.location.search)
          setCurrentPrimaryPage('spells')
          setPrimaryPages((prev) => mergePrimaryPageEntry(prev, { name: 'spells', props: spellProps }))
        }
        // Contextual RSS article: align primary pane when using browser history
        let rssPathSync = window.location.pathname.split('?')[0].split('#')[0]
        try {
          if (urlToCheck.startsWith('http://') || urlToCheck.startsWith('https://')) {
            rssPathSync = new URL(urlToCheck).pathname
          }
        } catch {
          /* keep pathname */
        }
        const ctxRssPop = rssPathSync.match(
          /^\/(discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/rss-item\/([^/?#]+)/
        )
        if (ctxRssPop) {
          const resolvedPop = noteContextToPrimaryEntry(ctxRssPop[1])
          if (resolvedPop) {
            setCurrentPrimaryPage(resolvedPop.name)
            setPrimaryPages((prev) => mergePrimaryPageEntry(prev, resolvedPop))
            setSavedPrimaryPage(resolvedPop.name)
          }
        } else if (/^\/rss-item\/[^/?#]+/.test(rssPathSync)) {
          setCurrentPrimaryPage('rss')
          setPrimaryPages((prev) => mergePrimaryPageEntry(prev, { name: 'rss' }))
          setSavedPrimaryPage('rss')
        }
      }
      
      // If not a note URL and drawer is open - close the drawer immediately
      // Only in single-pane mode or mobile
      if (!noteIdToShow && drawerOpen && (isSmallScreen || panelMode === 'single')) {
        setDrawerOpen(false)
      }

      setSecondaryStack((pre) => {
        const currentItem = pre[pre.length - 1] as TStackItem | undefined
        const currentIndex = currentItem?.index
        if (!state) {
          const locUrl =
            window.location.pathname + window.location.search + window.location.hash
          if (locUrl !== '/' && locUrl !== '') {
            const synced = syncSecondaryStackWhenPopStateStateIsNull(pre, locUrl)
            if ((isSmallScreen || panelMode === 'single') && drawerOpen && drawerNoteId && synced.length > 0) {
              const topItemUrl = synced[synced.length - 1]?.url
              if (topItemUrl) {
                const topNoteUrlMatch =
                  topItemUrl.match(
                    /\/(discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/notes\/(.+)$/
                  ) || topItemUrl.match(/\/notes\/(.+)$/)
                if (topNoteUrlMatch) {
                  const topNoteId = topNoteUrlMatch[topNoteUrlMatch.length - 1]
                    .split('?')[0]
                    .split('#')[0]
                  if (topNoteId && topNoteId !== drawerNoteId) {
                    setTimeout(() => {
                      if (drawerOpen) {
                        openDrawer(topNoteId)
                      }
                    }, 0)
                  }
                }
              }
            }
            return synced
          }
          state = { index: -1, url: '/' }
        }

        // Go forward
        if (currentIndex === undefined || state.index > currentIndex) {
          const { newStack } = pushNewPageToStack(pre, state.url, maxStackSize)
          return newStack
        }

        if (state.index === currentIndex && currentItem) {
          const historyState = state
          const urlMatches =
            currentItem.url === historyState.url ||
            secondaryPanelUrlsMatch(currentItem.url, historyState.url)
          if (urlMatches) {
            return pre
          }
          const j = pre.findIndex(
            (item) =>
              item.index === historyState.index &&
              (item.url === historyState.url ||
                secondaryPanelUrlsMatch(item.url, historyState.url))
          )
          if (j >= 0) {
            const sliced = pre.slice(0, j + 1)
            const nt = sliced[sliced.length - 1]
            if (nt && !nt.component) {
              const { component, ref } = findAndCreateComponent(nt.url, nt.index)
              if (component) {
                nt.component = component
                nt.ref = ref
              }
            }
            return sliced
          }
          const built = findAndCreateComponent(historyState.url, historyState.index)
          if (built.component) {
            return [
              {
                index: historyState.index,
                url: historyState.url,
                component: built.component,
                ref: built.ref
              }
            ]
          }
          return syncSecondaryStackWhenPopStateStateIsNull(pre, historyState.url)
        }

        // Go back
        const newStack = pre.filter((item) => item.index <= state!.index)
        const topItem = newStack[newStack.length - 1] as TStackItem | undefined
        
        if (!topItem) {
          // Stack is empty - check if this is a primary page URL or a secondary route
          const pathname = state.url.split('?')[0].split('#')[0]
          const popSegments = pathname.split('/').filter(Boolean)
          const popFirstSeg = popSegments[0] ?? ''
          const popPrimaryMap = getPrimaryPageMap()
          const isPrimaryPage =
            popSegments.length === 0 ||
            (popSegments.length === 1 &&
              (popFirstSeg === 'discussions' ||
                popFirstSeg === 'home' ||
                popFirstSeg === 'explore' ||
                popFirstSeg in popPrimaryMap))
          
          // If it's a primary page URL, return empty stack (right panel will close)
          if (isPrimaryPage) {
            // On mobile or single-pane: if drawer is open, close it
            if (drawerOpen && (isSmallScreen || panelMode === 'single')) {
              pendingDrawerCloseUrlRef.current = restoredPrimaryBrowserUrl(pathname, state!.url)
              setDrawerOpen(false)
            }
            return []
          }
          
          // Check if navigating to a note URL (supports both /notes/{id} and /{context}/notes/{id})
          const noteUrlMatch = state.url.match(/\/(discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/notes\/(.+)$/) || 
                              state.url.match(/\/notes\/(.+)$/)
          if (noteUrlMatch) {
            const noteId = noteUrlMatch[noteUrlMatch.length - 1].split('?')[0].split('#')[0]
            if (noteId) {
              if (isSmallScreen || panelMode === 'single') {
                // Single-pane / mobile: align stack with history (returning `pre` left stale UI).
                openDrawer(noteId)
                const built = findAndCreateComponent(state.url, state.index)
                if (built.component) {
                  return [
                    { index: state.index, url: state.url, component: built.component, ref: built.ref }
                  ]
                }
                return syncSecondaryStackWhenPopStateStateIsNull(pre, state.url)
              }
              // Double-pane mode: continue with stack creation
            }
          }
          // Create a new stack item if it's a secondary route (e.g., /mutes)
          const { component, ref } = findAndCreateComponent(state.url, state.index)
          if (component) {
            newStack.push({
              index: state.index,
              url: state.url,
              component,
              ref
            })
          } else {
            // No component found - likely a primary page, return empty stack
            // On mobile or single-pane: if drawer is open, close it
            if (drawerOpen && (isSmallScreen || panelMode === 'single')) {
              closeDrawer()
            }
            return []
          }
        } else if (!topItem.component) {
          // Load the component if it's not cached (e.g. LRU cleared an older stack frame)
          const { component, ref } = findAndCreateComponent(topItem.url, topItem.index)
          if (component) {
            topItem.component = component
            topItem.ref = ref
          }
        }
        if (newStack.length === 0) {
          // On mobile or single-pane: if drawer is open, close it
          if (drawerOpen && (isSmallScreen || panelMode === 'single')) {
            closeDrawer()
          }
          // DO NOT update URL when closing panel - closing should NEVER affect the main page
        } else if (newStack.length > 0) {
          // Stack still has items - update drawer to show the top item's note (for mobile/single-pane)
          // Only update drawer if drawer is currently open (not in the process of closing)
          if ((isSmallScreen || panelMode === 'single') && drawerOpen && drawerNoteId) {
            // Extract noteId from top item's URL or from state.url
            const topItemUrl = newStack[newStack.length - 1]?.url || state?.url
            if (topItemUrl) {
              const topNoteUrlMatch = topItemUrl.match(/\/(discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/notes\/(.+)$/) || 
                                     topItemUrl.match(/\/notes\/(.+)$/)
              if (topNoteUrlMatch) {
                const topNoteId = topNoteUrlMatch[topNoteUrlMatch.length - 1].split('?')[0].split('#')[0]
                if (topNoteId && topNoteId !== drawerNoteId) {
                  // Use setTimeout to ensure drawer update happens after stack state is committed
                  setTimeout(() => {
                    // Double-check drawer is still open before updating
                    if (drawerOpen) {
                      openDrawer(topNoteId)
                    }
                  }, 0)
                }
              }
            }
          }
        }
        // If newStack.length === 0, we're closing - don't reopen the drawer
        return newStack
      })
    }

    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [
    isSmallScreen,
    openDrawer,
    closeDrawer,
    panelMode,
    drawerOpen,
    drawerNoteId /* keep in sync while drawer stays open (quote→note); stale id broke Back in single-pane */
  ])

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

  // Listen for panel mode changes from toggle
  useEffect(() => {
    const handlePanelModeChange = (e: CustomEvent<{ mode: 'single' | 'double' }>) => {
      setPanelMode(e.detail.mode)
      logger.debug('PageManager: Panel mode changed', { mode: e.detail.mode })
    }
    
    window.addEventListener('panelModeChanged', handlePanelModeChange as EventListener)
    return () => {
      window.removeEventListener('panelModeChanged', handlePanelModeChange as EventListener)
    }
  }, [])
  
  // Restore tab state when returning to primary page from browser back button
  useEffect(() => {
    if (secondaryStack.length === 0 && currentPrimaryPage) {
      const savedFeedState = savedFeedStateRef.current.get(currentPrimaryPage)
      
      // Restore tab state first
      if (savedFeedState?.tab) {
        logger.info('PageManager: Browser back - Restoring tab state', { page: currentPrimaryPage, tab: savedFeedState.tab })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: currentPrimaryPage, tab: savedFeedState.tab } 
        }))
        // Update ref immediately
        currentTabStateRef.current.set(currentPrimaryPage, savedFeedState.tab)
      }
    }
  }, [secondaryStack.length, currentPrimaryPage])


  const navigatePrimaryPage = (page: TPrimaryPageName, props?: any) => {
    // Clear any primary note view when navigating to a new primary page
    // This ensures menu clicks always take you to the primary page, not stuck on overlays
    setPrimaryNoteView(null)
    
    // Always clear secondary pages when navigating to a primary page via menu
    // This ensures clicking menu items always takes you to that page, not stuck on profile/note pages
    clearSecondaryPages()
    
    // Update primary pages and current page
    setPrimaryPages((prev) => {
      const exists = prev.find((p) => p.name === page)
      if (exists) {
        exists.props = props
        return [...prev]
      }
      return [...prev, { name: page, element: getPrimaryPageMap()[page], props }]
    })
    setCurrentPrimaryPage(page)
    
    // Update URL for primary pages (spells uses ?spell= for faux feeds)
    const newUrl = buildPrimaryPageUrl(page, props)
    window.history.pushState(null, '', newUrl)
    
    // NEVER scroll to top - feed should maintain scroll position at all times
  }

  const goBack = () => {
    if (primaryViewType === 'settings-sub') {
      navigatePrimaryPage('settings')
      return
    }
    if (
      primaryViewType === 'bookmarks' ||
      primaryViewType === 'pins' ||
      primaryViewType === 'interests' ||
      primaryViewType === 'mute'
    ) {
      setPrimaryNoteView(null)
      return
    }
    if (primaryViewType === 'following' || primaryViewType === 'others-relay-settings') {
      const currentPath = window.location.pathname
      const profileId = currentPath.replace('/users/', '').replace('/following', '').replace('/muted', '').replace('/relays', '')
      const profileUrl = `/users/${profileId}`
      window.history.pushState(null, '', profileUrl)
      setPrimaryNoteView(
        suspensePrimaryPage(<SecondaryProfilePageLazy id={profileId} index={0} hideTitlebar={true} />),
        'profile'
      )
      return
    }
    window.history.back()
  }

  const pushSecondaryPage = (url: string, index?: number) => {
    logger.component('PageManager', 'pushSecondaryPage called', { url })
    
    // Save tab state before navigating
    const currentTab = currentTabStateRef.current.get(currentPrimaryPage)

    if (currentPrimaryPage && currentTab) {
      logger.info('PageManager: Desktop - Saving page state', {
        page: currentPrimaryPage,
        tab: currentTab
      })
      savedFeedStateRef.current.set(currentPrimaryPage, { tab: currentTab })
    }
    
    setSecondaryStack((prevStack) => {
      logger.component('PageManager', 'Current secondary stack length', { length: prevStack.length })
      
      // For relay pages, clear the stack and start fresh to avoid confusion
      if (
        url.startsWith('/relays/') ||
        url.startsWith('/home/relays/') ||
        url.startsWith('/explore/relays/')
      ) {
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
        logger.component('PageManager', 'Page already exists, not scrolling')
        // NEVER scroll to top - maintain scroll position
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
    const stackLen = secondaryStackRef.current.length

    // In double-pane mode, never open drawer - just pop from stack
    if (panelMode === 'double' && !isSmallScreen) {
      if (stackLen === 1) {
        flushSync(() => {
          setSecondaryStack([])
        })
        secondaryStackRef.current = []
        replaceHistoryWithPrimaryPageUrl(
          currentPrimaryPage,
          primaryPagePropsRef.current.get(currentPrimaryPage) as { spell?: string } | undefined
        )

        const savedFeedState = savedFeedStateRef.current.get(currentPrimaryPage)

        // Restore tab state first
        if (savedFeedState?.tab) {
          logger.info('PageManager: Desktop - Restoring tab state', { page: currentPrimaryPage, tab: savedFeedState.tab })
          window.dispatchEvent(new CustomEvent('restorePageTab', { 
            detail: { page: currentPrimaryPage, tab: savedFeedState.tab } 
          }))
          currentTabStateRef.current.set(currentPrimaryPage, savedFeedState.tab)
        }
      } else if (stackLen > 1) {
        // Must use real history navigation: replaceState + slice desyncs URL from the session stack
        // (e.g. note → highlight → Back: bar shows the article but the panel still shows the highlight).
        // popstate applies {@link onPopState} so stack and URL stay aligned with pushState indices.
        window.history.back()
      } else {
        // Stack empty but user hit back/close: align URL to primary without history.go(-1), which
        // changes the address bar but does not run our stack sync (panel/URL desync + double-click).
        replaceHistoryWithPrimaryPageUrl(
          currentPrimaryPage,
          primaryPagePropsRef.current.get(currentPrimaryPage) as { spell?: string } | undefined
        )
      }
      return
    }
    
    // Single-pane mode or mobile: check if drawer is open and stack is empty - close drawer instead
    if (drawerOpen && stackLen === 0) {
      // Close drawer and reveal the background page
      setDrawerOpen(false)
      return
    }
    
    // On mobile or single-pane: if stack has 1 item and drawer is open, close drawer and clear stack
    if ((isSmallScreen || panelMode === 'single') && stackLen === 1 && drawerOpen) {
      setDrawerOpen(false)
      flushSync(() => {
        setSecondaryStack([])
      })
      secondaryStackRef.current = []

      const savedFeedState = savedFeedStateRef.current.get(currentPrimaryPage)

      if (savedFeedState?.tab) {
        logger.info('PageManager: Mobile/Single-pane - Restoring tab state', { page: currentPrimaryPage, tab: savedFeedState.tab })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: currentPrimaryPage, tab: savedFeedState.tab } 
        }))
        currentTabStateRef.current.set(currentPrimaryPage, savedFeedState.tab)
      }
      return
    }
    
    if (stackLen === 1) {
      flushSync(() => {
        setSecondaryStack([])
      })
      secondaryStackRef.current = []
      replaceHistoryWithPrimaryPageUrl(
        currentPrimaryPage,
        primaryPagePropsRef.current.get(currentPrimaryPage) as { spell?: string } | undefined
      )

      const savedFeedState = savedFeedStateRef.current.get(currentPrimaryPage)

      if (savedFeedState?.tab) {
        logger.info('PageManager: Desktop - Restoring tab state', { page: currentPrimaryPage, tab: savedFeedState.tab })
        window.dispatchEvent(new CustomEvent('restorePageTab', { 
          detail: { page: currentPrimaryPage, tab: savedFeedState.tab } 
        }))
        currentTabStateRef.current.set(currentPrimaryPage, savedFeedState.tab)
      }
    } else if (stackLen > 1) {
      // Same as double-pane: let popstate shrink the stack so it matches history.
      window.history.back()
    } else {
      replaceHistoryWithPrimaryPageUrl(
        currentPrimaryPage,
        primaryPagePropsRef.current.get(currentPrimaryPage) as { spell?: string } | undefined
      )
    }
  }

  const hardCloseSecondaryPanel = useCallback(() => {
    if (drawerOpen) setDrawerOpen(false)
    setSinglePaneSheetOpen(false)
    setSecondaryStack((prev) => (prev.length ? [] : prev))
    secondaryStackRef.current = []
    const page = currentPrimaryPageRef.current
    replaceHistoryWithPrimaryPageUrl(
      page,
      primaryPagePropsRef.current.get(page) as { spell?: string } | undefined
    )
  }, [drawerOpen])

  const clearSecondaryPages = () => {
    hardCloseSecondaryPanel()
  }

  useEffect(() => {
    const shouldBeOpen =
      panelMode === 'single' &&
      !isSmallScreen &&
      secondaryStack.length > 0 &&
      !drawerOpen
    setSinglePaneSheetOpen(shouldBeOpen)
  }, [panelMode, isSmallScreen, secondaryStack.length, drawerOpen])

  const primaryPageContextValue: PrimaryPageContextValue = {
    navigate: navigatePrimaryPage,
    current: currentPrimaryPage,
    currentPageProps,
    display: isSmallScreen ? secondaryStack.length === 0 : true
  }

  return (
    <PrimaryPageContext.Provider value={primaryPageContextValue}>
      {isSmallScreen ? (
        <KeyboardShortcutsHelpProvider>
        <SecondaryPageContext.Provider
          value={{
            push: pushSecondaryPage,
            pop: popSecondaryPage,
            currentIndex: secondaryStack.length
              ? secondaryStack[secondaryStack.length - 1].index
              : 0,
            navigateToPrimaryPage: navigatePrimaryPage
          }}
        >
        <CurrentRelaysProvider>
            <PrimaryNoteViewContext.Provider
              value={{
                setPrimaryNoteView,
                primaryViewType,
                getNavigationCounter: () => navigationCounterRef.current,
                getTopSecondaryUrl: () =>
                  secondaryStack.length > 0 ? secondaryStack[secondaryStack.length - 1].url : undefined,
                registerPrimaryPanelRefresh,
                triggerPrimaryPanelRefresh
              }}
            >
            <NoteDrawerContext.Provider value={{ openDrawer, closeDrawer, isDrawerOpen: drawerOpen, drawerNoteId, drawerInitialEvent }}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <LiveActivitiesStrip placement="mobile" />
            {primaryNoteView ? (
              // Show primary note view with back button on mobile
              <div className="flex min-h-0 flex-1 flex-col h-full w-full">
                <div className="flex justify-center py-1 border-b">
                  <span className="text-green-600 dark:text-green-500 font-semibold text-sm">
                    Imwald
                  </span>
                </div>
                <div className="flex gap-1 p-1 items-center justify-between font-semibold border-b">
                  <div className="flex min-w-0 flex-1 items-center">
                    <Button
                      className="flex min-w-0 max-w-full gap-1 justify-start pl-2 pr-3"
                      variant="ghost"
                      size="titlebar-icon"
                      title="Back to feed"
                      onClick={goBack}
                    >
                      <ChevronLeft />
                      <div className="truncate text-lg font-semibold">
                        {primaryViewType === 'settings' || primaryViewType === 'settings-sub'
                          ? 'Settings'
                          : primaryViewType === 'profile'
                            ? 'Back'
                            : getPageTitle(primaryViewType, window.location.pathname)}
                      </div>
                    </Button>
                  </div>
                  <RefreshButton onClick={triggerPrimaryPanelRefresh} />
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
                    {props ? applyPrimaryPageProps(element, props) : element}
                  </div>
                ))}
              </>
            )}
            </div>
            {drawerNoteId && (
              <NoteDrawer
                open={drawerOpen}
                initialEvent={drawerInitialEvent}
                onOpenChange={setDrawerOpen}
                noteId={drawerNoteId}
              />
            )}
            <Suspense fallback={null}>
              <BottomNavigationBarLazy />
            </Suspense>
            <Suspense fallback={null}>
              <TooManyRelaysAlertDialogLazy />
            </Suspense>
            <Suspense fallback={null}>
              <CreateWalletGuideToastLazy />
            </Suspense>
            <Suspense fallback={null}>
              <RelayPulseActiveNpubsSheetLazy />
            </Suspense>
            </NoteDrawerContext.Provider>
            </PrimaryNoteViewContext.Provider>
        </CurrentRelaysProvider>
        </SecondaryPageContext.Provider>
        </KeyboardShortcutsHelpProvider>
      ) : (
      <KeyboardShortcutsHelpProvider>
      <SecondaryPageContext.Provider
        value={{
          push: pushSecondaryPage,
          pop: popSecondaryPage,
          currentIndex: secondaryStack.length ? secondaryStack[secondaryStack.length - 1].index : 0,
          navigateToPrimaryPage: navigatePrimaryPage
        }}
      >
        <CurrentRelaysProvider>
            <PrimaryNoteViewContext.Provider
              value={{
                setPrimaryNoteView,
                primaryViewType,
                getNavigationCounter: () => navigationCounterRef.current,
                getTopSecondaryUrl: () =>
                  secondaryStack.length > 0 ? secondaryStack[secondaryStack.length - 1].url : undefined,
                registerPrimaryPanelRefresh,
                triggerPrimaryPanelRefresh
              }}
            >
            <NoteDrawerContext.Provider value={{ openDrawer, closeDrawer, isDrawerOpen: drawerOpen, drawerNoteId, drawerInitialEvent }}>
            <div className="flex flex-col items-center bg-surface-background">
              <div
                className="flex h-[var(--vh)] w-full bg-surface-background"
                style={{
                  maxWidth: '1920px'
                }}
              >
                <Suspense fallback={null}>
                  <SidebarLazy />
                </Suspense>
                {(() => {
                  if (panelMode === 'double') {
                    // Double-pane mode: show feed on left (flexible, maintains width), secondary stack on right (1042px, same as drawer)
                    return (
                      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                        {/* Left: primary column — must be a flex column so MainContentArea flex-1 gets height */}
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r">
                          <MainContentArea
                            primaryPages={primaryPages}
                            currentPrimaryPage={currentPrimaryPage}
                            primaryNoteView={primaryNoteView}
                            primaryViewType={primaryViewType}
                            goBack={goBack}
                            onPrimaryPanelRefresh={triggerPrimaryPanelRefresh}
                          />
                        </div>
                        {/* Right: secondary stack — max width so left pane keeps space on small desktops */}
                        <div className="flex h-full min-h-0 w-[min(1042px,50vw)] shrink-0 flex-col overflow-hidden border-l border-border/60 bg-muted/20">
                          {secondaryStack.length > 0 ? (
                            secondaryStack.map((item, index) => {
                              const isLast = index === secondaryStack.length - 1
                              return (
                                <div
                                  key={item.index}
                                  className={cn(
                                    'h-full min-h-0 min-w-0 flex-col',
                                    isLast ? 'flex' : 'hidden'
                                  )}
                                >
                                  {item.component}
                                </div>
                              )
                            })
                          ) : (
                            <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                              <p>{t('doublePane.secondaryEmpty')}</p>
                              <p className="text-xs opacity-80">{t('doublePane.secondaryEmptyHint')}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  } else {
                    // Single-pane mode: show feed only, drawer overlay for notes
                    return (
                      <div className="flex-1 flex flex-col min-h-0 min-w-0">
                        <MainContentArea 
                          primaryPages={primaryPages}
                          currentPrimaryPage={currentPrimaryPage}
                          primaryNoteView={primaryNoteView}
                          primaryViewType={primaryViewType}
                          goBack={goBack}
                          onPrimaryPanelRefresh={triggerPrimaryPanelRefresh}
                        />
                      </div>
                    )
                  }
                })()}
              </div>
            </div>
            {drawerNoteId && (
              <NoteDrawer
                open={drawerOpen}
                initialEvent={drawerInitialEvent}
                onOpenChange={setDrawerOpen}
                noteId={drawerNoteId}
              />
            )}
            {/* Generic drawer for secondary stack in single-pane mode (for relay pages, etc.) */}
            {panelMode === 'single' &&
              !isSmallScreen &&
              secondaryStack.length > 0 &&
              !drawerOpen && (
              <Sheet
                open={singlePaneSheetOpen}
                registerWithModalManager={false}
                onOpenChange={(open) => {
                  if (!open) {
                    setSinglePaneSheetOpen(false)
                    // Close side panel immediately and clear the whole secondary stack.
                    hardCloseSecondaryPanel()
                  }
                }}
              >
                <SheetContent side="right" className="w-full sm:max-w-[1042px] overflow-y-auto p-0">
                  <div className="h-full">
                    {secondaryStack.map((item, index) => {
                      const isLast = index === secondaryStack.length - 1
                      if (!isLast) return null
                      return (
                        <div key={item.index}>
                          {item.component}
                        </div>
                      )
                    })}
                  </div>
                </SheetContent>
              </Sheet>
            )}
            <Suspense fallback={null}>
              <TooManyRelaysAlertDialogLazy />
            </Suspense>
            <Suspense fallback={null}>
              <CreateWalletGuideToastLazy />
            </Suspense>
            <Suspense fallback={null}>
              <RelayPulseActiveNpubsSheetLazy />
            </Suspense>
            </NoteDrawerContext.Provider>
            </PrimaryNoteViewContext.Provider>
        </CurrentRelaysProvider>
      </SecondaryPageContext.Provider>
      </KeyboardShortcutsHelpProvider>
      )}
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

/** Route elements are `<Suspense><LazyPage /></Suspense>` — props must be applied to the lazy leaf, not Suspense. */
function cloneSecondaryRouteElement(
  element: ReactElement,
  props: Record<string, unknown>
): ReactElement {
  if (element.type === Suspense) {
    const inner = element.props.children
    if (isValidElement(inner)) {
      return cloneElement(element, undefined, cloneElement(inner, props as any))
    }
  }
  return cloneElement(element, props as any)
}

/** Hex id segment from /notes/{id} or /{context}/notes/{id} (query/hash stripped). */
function noteHexIdFromSecondaryNoteUrl(url: string): string | null {
  const contextual = url.match(
    /\/(?:discussions|search|profile|home|feed|spells|explore|rss|follows-latest)\/notes\/(.+)$/
  )
  const standard = url.match(/\/notes\/(.+)$/)
  const m = contextual || standard
  return m ? m[m.length - 1].split('?')[0].split('#')[0] : null
}

/** Same secondary destination as /notes/x vs /explore/notes/x (different paths, one note). */
function secondaryPanelUrlsMatch(stackUrl: string, locationUrl: string): boolean {
  if (stackUrl === locationUrl) return true
  const idA = noteHexIdFromSecondaryNoteUrl(stackUrl)
  const idB = noteHexIdFromSecondaryNoteUrl(locationUrl)
  return Boolean(idA && idB && idA === idB)
}

/**
 * When popstate has no history state (e.g. after pushState(null, …) on load), the URL still updates
 * but we must realign the secondary stack; otherwise the panel shows a stale page.
 */
function syncSecondaryStackWhenPopStateStateIsNull(pre: TStackItem[], locUrl: string): TStackItem[] {
  const pathOnly = locUrl.split('?')[0].split('#')[0]
  const segments = pathOnly.split('/').filter(Boolean)
  const firstSeg = segments[0] ?? ''
  const primaryMap = getPrimaryPageMap()
  const isPrimaryOnly =
    segments.length === 0 ||
    (segments.length === 1 &&
      (firstSeg === 'discussions' ||
        firstSeg === 'home' ||
        firstSeg === 'explore' ||
        firstSeg in primaryMap))
  if (isPrimaryOnly) {
    return []
  }

  const top = pre[pre.length - 1]
  if (top && secondaryPanelUrlsMatch(top.url, locUrl)) {
    return pre
  }

  for (let i = pre.length - 1; i >= 0; i--) {
    if (secondaryPanelUrlsMatch(pre[i].url, locUrl)) {
      const newStack = pre.slice(0, i + 1)
      const newTop = newStack[newStack.length - 1]
      if (newTop && !newTop.component) {
        const { component, ref } = findAndCreateComponent(newTop.url, newTop.index)
        if (component) {
          newTop.component = component
          newTop.ref = ref
        }
      }
      return newStack
    }
  }

  const nextIdx = pre.length === 0 ? 0 : Math.max(...pre.map((x) => x.index)) + 1
  const { component, ref } = findAndCreateComponent(locUrl, nextIdx)
  if (!component) {
    return []
  }
  return [{ index: nextIdx, url: locUrl, component, ref }]
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
      const component = cloneSecondaryRouteElement(element, { ...params, index, ref })
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
