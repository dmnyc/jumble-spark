import { match } from 'path-to-regexp'
import {
  isValidElement,
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement
} from 'react'

/** Lazy + Suspense so importing `routes` does not sync-pull pages that depend on PageManager (breaks Vite HMR cycles). */
const FollowingListPageLazy = lazy(() => import('./pages/secondary/FollowingListPage'))
const GeneralSettingsPageLazy = lazy(() => import('./pages/secondary/GeneralSettingsPage'))
const MuteListPageLazy = lazy(() => import('./pages/secondary/MuteListPage'))
const NoteListPageLazy = lazy(() => import('./pages/secondary/NoteListPage'))
const NotePageLazy = lazy(() => import('./pages/secondary/NotePage'))
const OthersRelaySettingsPageLazy = lazy(() => import('./pages/secondary/OthersRelaySettingsPage'))
const PostSettingsPageLazy = lazy(() => import('./pages/secondary/PostSettingsPage'))
const ProfileEditorPageLazy = lazy(() => import('./pages/secondary/ProfileEditorPage'))
const ProfileListPageLazy = lazy(() => import('./pages/secondary/ProfileListPage'))
const ProfilePageLazy = lazy(() => import('./pages/secondary/ProfilePage'))
const RelayPageLazy = lazy(() => import('./pages/secondary/RelayPage'))
const RelayReviewsPageLazy = lazy(() => import('./pages/secondary/RelayReviewsPage'))
const RelaySettingsPageLazy = lazy(() => import('./pages/secondary/RelaySettingsPage'))
const CacheSettingsPageLazy = lazy(() => import('./pages/secondary/CacheSettingsPage'))
const RssFeedSettingsPageLazy = lazy(() => import('./pages/secondary/RssFeedSettingsPage'))
const SearchPageLazy = lazy(() => import('./pages/secondary/SearchPage'))
const SettingsPageLazy = lazy(() => import('./pages/secondary/SettingsPage'))
const TranslationPageLazy = lazy(() => import('./pages/secondary/TranslationPage'))
const WalletPageLazy = lazy(() => import('./pages/secondary/WalletPage'))
const FollowPacksRedirectLazy = lazy(() => import('./pages/secondary/FollowPacksRedirect'))
const RssArticlePageLazy = lazy(() => import('./pages/secondary/RssArticlePage'))

const routeSuspenseFallback = null

function SR(C: LazyExoticComponent<ComponentType<any>>): ReactElement {
  return (
    <Suspense fallback={routeSuspenseFallback}>
      <C />
    </Suspense>
  )
}

const ROUTES = [
  { path: '/notes', element: SR(NoteListPageLazy) },
  { path: '/notes/:id', element: SR(NotePageLazy) },
  { path: '/discussions/notes/:id', element: SR(NotePageLazy) },
  { path: '/search/notes/:id', element: SR(NotePageLazy) },
  { path: '/profile/notes/:id', element: SR(NotePageLazy) },
  { path: '/explore/notes/:id', element: SR(NotePageLazy) },
  { path: '/home/notes/:id', element: SR(NotePageLazy) },
  { path: '/feed/notes/:id', element: SR(NotePageLazy) },
  { path: '/spells/notes/:id', element: SR(NotePageLazy) },
  { path: '/rss/notes/:id', element: SR(NotePageLazy) },
  { path: '/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/rss/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/feed/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/search/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/profile/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/spells/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/explore/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/home/rss-item/:articleKey', element: SR(RssArticlePageLazy) },
  { path: '/users', element: SR(ProfileListPageLazy) },
  { path: '/users/:id', element: SR(ProfilePageLazy) },
  { path: '/users/:id/following', element: SR(FollowingListPageLazy) },
  { path: '/users/:id/relays', element: SR(OthersRelaySettingsPageLazy) },
  { path: '/relays/:url', element: SR(RelayPageLazy) },
  { path: '/relays/:url/reviews', element: SR(RelayReviewsPageLazy) },
  { path: '/home/relays/:url', element: SR(RelayPageLazy) },
  { path: '/explore/relays/:url', element: SR(RelayPageLazy) },
  { path: '/search', element: SR(SearchPageLazy) },
  { path: '/settings', element: SR(SettingsPageLazy) },
  { path: '/settings/relays', element: SR(RelaySettingsPageLazy) },
  { path: '/settings/cache', element: SR(CacheSettingsPageLazy) },
  { path: '/settings/wallet', element: SR(WalletPageLazy) },
  { path: '/settings/posts', element: SR(PostSettingsPageLazy) },
  { path: '/settings/general', element: SR(GeneralSettingsPageLazy) },
  { path: '/settings/translation', element: SR(TranslationPageLazy) },
  { path: '/settings/rss-feeds', element: SR(RssFeedSettingsPageLazy) },
  { path: '/profile-editor', element: SR(ProfileEditorPageLazy) },
  { path: '/mutes', element: SR(MuteListPageLazy) },
  { path: '/follow-packs', element: SR(FollowPacksRedirectLazy) }
]

export const routes = ROUTES.map(({ path, element }) => ({
  path,
  element: isValidElement(element) ? element : null,
  matcher: match(path)
}))
