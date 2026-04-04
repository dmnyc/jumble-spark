import SearchInput from '@/components/SearchInput'
import { useSearchProfiles } from '@/hooks'
import { toNote, toNoteList } from '@/lib/link'
import client from '@/services/client.service'
import { eventService } from '@/services/client.service'
import { randomString } from '@/lib/random'
import { normalizeUrl } from '@/lib/url'
import { normalizeToDTag } from '@/lib/search-parser'
import { cn } from '@/lib/utils'
import { useSmartNoteNavigation, useSmartHashtagNavigation } from '@/PageManager'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import modalManager from '@/services/modal-manager.service'
import { TSearchParams } from '@/types'
import { Hash, Notebook, Search, Server, FileText } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import {
  forwardRef,
  HTMLAttributes,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import UserItem, { UserItemSkeleton } from '../UserItem'

const SearchBar = forwardRef<
  TSearchBarRef,
  {
    input: string
    setInput: (input: string) => void
    onSearch: (params: TSearchParams | null) => void
  }
>(({ input, setInput, onSearch }, ref) => {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
  const { navigateToHashtag } = useSmartHashtagNavigation()
  const { isSmallScreen } = useScreenSize()
  const [debouncedInput, setDebouncedInput] = useState(input)
  const { profiles, isFetching: isFetchingProfiles } = useSearchProfiles(debouncedInput, 5)
  const [searching, setSearching] = useState(false)
  const [displayList, setDisplayList] = useState(false)
  const [selectableOptions, setSelectableOptions] = useState<TSearchParams[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const barContainerRef = useRef<HTMLDivElement>(null)
  const [suggestPanelTop, setSuggestPanelTop] = useState(0)
  const normalizedUrl = useMemo(() => {
    if (['w', 'ws', 'ws:', 'ws:/', 'wss', 'wss:', 'wss:/'].includes(input)) {
      return undefined
    }
    try {
      return normalizeUrl(input)
    } catch {
      return undefined
    }
  }, [input])
  const id = useMemo(() => `search-${randomString()}`, [])

  useImperativeHandle(ref, () => ({
    focus: () => {
      searchInputRef.current?.focus()
    },
    blur: () => {
      searchInputRef.current?.blur()
    }
  }))

  useEffect(() => {
    if (!input) {
      onSearch(null)
    }
    setSelectedIndex(-1)
  }, [input])

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedInput(input)
    }, 500)

    return () => {
      clearTimeout(handler)
    }
  }, [input])

  const blur = () => {
    setSearching(false)
    searchInputRef.current?.blur()
  }

  const updateSearch = (params: TSearchParams) => {
    blur()

    if (params.type === 'note') {
      // Prime event cache so note page finds it without re-fetch
      eventService.fetchEvent(params.search).then((ev) => { if (ev) eventService.addEventToCache(ev) }).catch(() => {})
      navigateToNote(toNote(params.search))
    } else if (params.type === 'hashtag') {
      navigateToHashtag(toNoteList({ hashtag: params.search }))
    } else if (params.type === 'dtag') {
      // Navigate to d-tag search using same pattern as hashtag
      navigateToHashtag(toNoteList({ domain: params.search }))
    } else if (params.type === 'profile') {
      // Prime profile cache so profile page finds it without re-fetch
      client.fetchProfileEvent(params.search).catch(() => {})
      onSearch(params)
    } else {
      onSearch(params)
    }
  }

  useEffect(() => {
    const search = input.trim()
    if (!search) return

    if (/^[0-9a-f]{64}$/.test(search)) {
      setSelectableOptions([
        { type: 'note', search },
        { type: 'profile', search }
      ])
      return
    }

    try {
      let id = search
      if (id.startsWith('nostr:')) {
        id = id.slice(6)
      }
      const { type } = nip19.decode(id)
      if (['nprofile', 'npub'].includes(type)) {
        setSelectableOptions([{ type: 'profile', search: id }])
        return
      }
      if (['nevent', 'naddr', 'note'].includes(type)) {
        setSelectableOptions([{ type: 'note', search: id }])
        return
      }
    } catch {
      // ignore
    }

    const hashtag = search.match(/[\p{L}\p{N}\p{M}]+/u)?.[0].toLowerCase() ?? ''
    const normalizedDTag = normalizeToDTag(search)

    setSelectableOptions([
      { type: 'notes', search },
      { type: 'hashtag', search: hashtag, input: `#${hashtag}` },
      ...(normalizedDTag && normalizedDTag.length > 0 ? [{ type: 'dtag', search: normalizedDTag, input: search }] : []),
      ...(normalizedUrl ? [{ type: 'relay', search: normalizedUrl, input: normalizedUrl }] : []),
      ...profiles.map((profile) => ({
        type: 'profile' as const,
        search: profile.npub,
        input: profile.username,
        profile
      })),
      ...(profiles.length >= 5 ? [{ type: 'profiles', search }] : [])
    ] as TSearchParams[])
  }, [input, debouncedInput, profiles])

  const list = useMemo(() => {
    if (selectableOptions.length <= 0) {
      return null
    }

    return (
      <>
        {selectableOptions.map((option, index) => {
          if (option.type === 'note') {
            return (
              <NoteItem
                key={index}
                selected={selectedIndex === index}
                id={option.search}
                onClick={() => updateSearch(option)}
              />
            )
          }
          if (option.type === 'profile') {
            return (
              <ProfileItem
                key={`profile-${option.search}`}
                selected={selectedIndex === index}
                userId={option.search}
                prefetchedProfile={option.profile}
                onClick={() => updateSearch(option)}
              />
            )
          }
          if (option.type === 'notes') {
            return (
              <NormalItem
                key={index}
                selected={selectedIndex === index}
                search={option.search}
                onClick={() => updateSearch(option)}
              />
            )
          }
          if (option.type === 'hashtag') {
            return (
              <HashtagItem
                key={index}
                selected={selectedIndex === index}
                hashtag={option.search}
                onClick={() => updateSearch(option)}
              />
            )
          }
          if (option.type === 'dtag') {
            return (
              <DTagItem
                key={index}
                selected={selectedIndex === index}
                dtag={option.search}
                onClick={() => updateSearch(option)}
              />
            )
          }
          if (option.type === 'relay') {
            return (
              <RelayItem
                key={index}
                selected={selectedIndex === index}
                url={option.search}
                onClick={() => updateSearch(option)}
              />
            )
          }
          if (option.type === 'profiles') {
            return (
              <Item
                key={index}
                selected={selectedIndex === index}
                onClick={() => updateSearch(option)}
              >
                <div className="font-semibold">{t('Show more...')}</div>
              </Item>
            )
          }
          return null
        })}
        {isFetchingProfiles && profiles.length < 5 && (
          <div className="px-2">
            <UserItemSkeleton hideFollowButton />
          </div>
        )}
      </>
    )
  }, [selectableOptions, selectedIndex, isFetchingProfiles, profiles])

  useEffect(() => {
    setDisplayList(searching && !!input)
  }, [searching, input])

  useEffect(() => {
    if (displayList && list) {
      modalManager.register(id, () => {
        setDisplayList(false)
      })
    } else {
      modalManager.unregister(id)
    }
  }, [displayList, list])

  const updateSuggestPanelGeometry = useCallback(() => {
    const el = barContainerRef.current
    if (!el) return
    setSuggestPanelTop(el.getBoundingClientRect().bottom)
  }, [])

  useLayoutEffect(() => {
    if (!displayList || !list || !isSmallScreen) return
    updateSuggestPanelGeometry()
    const onScrollOrResize = () => updateSuggestPanelGeometry()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [displayList, list, isSmallScreen, input, updateSuggestPanelGeometry])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation()
        if (selectableOptions.length <= 0) {
          return
        }
        onSearch(selectableOptions[selectedIndex >= 0 ? selectedIndex : 0])
        blur()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (selectableOptions.length <= 0) {
          return
        }
        setSelectedIndex((prev) => (prev + 1) % selectableOptions.length)
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (selectableOptions.length <= 0) {
          return
        }
        setSelectedIndex((prev) => (prev - 1 + selectableOptions.length) % selectableOptions.length)
        return
      }

      if (e.key === 'Escape') {
        blur()
        return
      }
    },
    [input, onSearch, selectableOptions, selectedIndex]
  )

  const suggestTopPx = Math.max(0, suggestPanelTop - 4)
  const suggestionsPanel = list ? (
    <div
      className={cn(
        'bg-surface-background shadow-lg',
        isSmallScreen
          ? 'fixed left-4 right-4 z-[110] overflow-y-auto rounded-b-lg border border-t-0 border-border/80 pt-1'
          : 'absolute top-full z-50 -translate-y-1 inset-x-0 rounded-b-lg pt-1'
      )}
      style={
        isSmallScreen
          ? {
              top: suggestTopPx,
              maxHeight: `calc(100dvh - ${suggestTopPx}px - 3.25rem - env(safe-area-inset-bottom, 0px))`
            }
          : undefined
      }
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="h-fit">{list}</div>
    </div>
  ) : null

  return (
    <div ref={barContainerRef} className="relative flex gap-1 items-center h-full w-full">
      {displayList && list && !isSmallScreen && (
        <>
          {suggestionsPanel}
          <div
            className="fixed inset-0 z-40 w-full h-full"
            onClick={() => blur()}
            aria-hidden
          />
        </>
      )}
      {displayList && list && isSmallScreen && (
        <>
          <div
            className="fixed inset-0 z-[100] w-full h-full"
            onClick={() => blur()}
            aria-hidden
          />
          {suggestionsPanel}
        </>
      )}
      <SearchInput
        ref={searchInputRef}
        className={cn(
          'bg-surface-background shadow-inner h-full border-none',
          searching && isSmallScreen && 'relative z-[120]',
          searching && !isSmallScreen && 'z-50'
        )}
        placeholder={t('People, keywords, or relays')}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setSearching(true)}
        onBlur={() => setSearching(false)}
      />
    </div>
  )
})
SearchBar.displayName = 'SearchBar'
export default SearchBar

export type TSearchBarRef = {
  focus: () => void
  blur: () => void
}

function NormalItem({
  search,
  onClick,
  selected
}: {
  search: string
  onClick?: () => void
  selected?: boolean
}) {
  return (
    <Item onClick={onClick} selected={selected}>
      <div className="flex flex-col items-center gap-0.5">
        <Search className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground/70 uppercase leading-none">FULL TEXT</span>
      </div>
      <div className="font-semibold truncate">{search}</div>
    </Item>
  )
}

function HashtagItem({
  hashtag,
  onClick,
  selected
}: {
  hashtag: string
  onClick?: () => void
  selected?: boolean
}) {
  return (
    <Item onClick={onClick} selected={selected}>
      <div className="flex flex-col items-center gap-0.5">
        <Hash className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground/70 uppercase leading-none">HASHTAG</span>
      </div>
      <div className="font-semibold truncate">{hashtag}</div>
    </Item>
  )
}

function NoteItem({
  id,
  onClick,
  selected
}: {
  id: string
  onClick?: () => void
  selected?: boolean
}) {
  return (
    <Item onClick={onClick} selected={selected}>
      <div className="flex flex-col items-center gap-0.5">
        <Notebook className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground/70 uppercase leading-none">NOTE</span>
      </div>
      <div className="font-semibold truncate">{id}</div>
    </Item>
  )
}

function ProfileItem({
  userId,
  prefetchedProfile,
  onClick,
  selected
}: {
  userId: string
  prefetchedProfile?: TSearchParams['profile']
  onClick?: () => void
  selected?: boolean
}) {
  return (
    <div
      className={cn('px-2 hover:bg-accent rounded-md cursor-pointer', selected && 'bg-accent')}
      onClick={onClick}
    >
      <UserItem
        pubkey={userId}
        hideFollowButton
        className="pointer-events-none"
        prefetchedProfile={prefetchedProfile}
      />
    </div>
  )
}

function DTagItem({
  dtag,
  onClick,
  selected
}: {
  dtag: string
  onClick?: () => void
  selected?: boolean
}) {
  return (
    <Item onClick={onClick} selected={selected}>
      <div className="flex flex-col items-center gap-0.5">
        <FileText className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground/70 uppercase leading-none">D-TAG</span>
      </div>
      <div className="font-semibold truncate">{dtag}</div>
    </Item>
  )
}

function RelayItem({
  url,
  onClick,
  selected
}: {
  url: string
  onClick?: () => void
  selected?: boolean
}) {
  return (
    <Item onClick={onClick} selected={selected}>
      <div className="flex flex-col items-center gap-0.5">
        <Server className="text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground/70 uppercase leading-none">RELAY</span>
      </div>
      <div className="font-semibold truncate">{url}</div>
    </Item>
  )
}

function Item({
  className,
  children,
  selected,
  ...props
}: HTMLAttributes<HTMLDivElement> & { selected?: boolean }) {
  return (
    <div
      className={cn(
        'flex gap-2 items-center px-2 py-3 hover:bg-accent rounded-md cursor-pointer',
        selected ? 'bg-accent' : '',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
