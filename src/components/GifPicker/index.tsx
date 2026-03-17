import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useNostr } from '@/providers/NostrProvider'
import { ExtendedKind, GIF_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { fetchGifs, searchGifs, type GifMetadata } from '@/services/gif.service'
import mediaUpload from '@/services/media-upload.service'
import { ExternalLink, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const GIFBUDDY_URL = 'https://www.gifbuddy.lol/'
/** Query param gifbuddy may use for pre-filled search (common convention). */
const GIFBUDDY_SEARCH_URL = (q: string) =>
  q.trim() ? `${GIFBUDDY_URL}gifsearch?q=${encodeURIComponent(q.trim())}` : GIFBUDDY_URL

export default function GifPicker({
  children,
  onSelect,
  portalContainer
}: {
  children: React.ReactNode
  onSelect?: (gifUrl: string) => void
  /** When set (e.g. inside a modal), picker content portals here so it stays on top of the modal */
  portalContainer?: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { publish, pubkey, relayList } = useNostr()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [gifs, setGifs] = useState<GifMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pasteUrl, setPasteUrl] = useState('')
  const [publishingPaste, setPublishingPaste] = useState(false)
  const [publishDescription, setPublishDescription] = useState('')
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const gifbuddyPopupRef = useRef<Window | null>(null)

  const userReadRelays = relayList?.read ?? []
  const userWriteRelays = relayList?.write ?? []

  const loadGifs = useCallback(async (q: string, forceRefresh = false) => {
    setError(null)
    setLoading(true)
    try {
      const results = q.trim()
        ? await searchGifs(q.trim(), 50, forceRefresh, userReadRelays, pubkey ?? null)
        : await fetchGifs(undefined, 50, forceRefresh, userReadRelays, pubkey ?? null)
      setGifs(results)
      if (results.length === 0 && !q.trim()) {
        setError(
          t(
            'No GIFs found. Try searching or add your own. GIFs come from Nostr kind 1063 (NIP-94) events on GIF relays.'
          )
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load GIFs')
      setGifs([])
    } finally {
      setLoading(false)
    }
  }, [t, userReadRelays, pubkey])

  useEffect(() => {
    if (!open) return
    loadGifs(query)
  }, [open, query, loadGifs])

  useEffect(() => {
    if (!open) return
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setQuery(searchInput)
    }, 300)
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [searchInput, open])

  const handleSelect = (gif: GifMetadata) => {
    const url = gif.fallbackUrl || gif.url
    onSelect?.(url)
    setOpen(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !pubkey) return
    setUploadError(null)
    setUploading(true)
    try {
      if (!file.type.includes('gif') && !file.name.toLowerCase().endsWith('.gif')) {
        setUploadError(t('{{name}} is not a GIF file', { name: file.name }))
        return
      }
      const { url } = await mediaUpload.upload(file)
      const draft = {
        kind: ExtendedKind.FILE_METADATA,
        content: publishDescription.trim(),
        tags: [
          ['file', url, file.type || 'image/gif', `size ${file.size}`],
          ['url', url],
          ['m', file.type || 'image/gif'],
          ['t', 'gif']
        ],
        created_at: Math.floor(Date.now() / 1000)
      }
      const writeUrls = [...GIF_RELAY_URLS, ...userWriteRelays]
      const seen = new Set<string>()
      const specifiedRelayUrls = writeUrls.filter((u) => {
        const n = (normalizeUrl(u) ?? u).toLowerCase()
        if (seen.has(n)) return false
        seen.add(n)
        return true
      })
      await publish(draft, { specifiedRelayUrls })
      setPublishDescription('')
      setQuery('')
      await loadGifs('', true)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const triggerFileUpload = () => fileInputRef.current?.click()

  const isLoggedIn = !!pubkey

  /** Open GifBuddy in a new tab (not a popup) so the picker doesn't close from focus loss. Listen for postMessage in case GifBuddy adds embed support. */
  const openGifBuddySearch = useCallback(() => {
    const url = GIFBUDDY_SEARCH_URL(searchInput)
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    gifbuddyPopupRef.current = w ?? null
    const handler = (event: MessageEvent) => {
      if (event.origin !== 'https://www.gifbuddy.lol' && event.origin !== 'https://gifbuddy.lol') return
      const data = event.data
      const urlToInsert =
        typeof data === 'string' && (data.startsWith('http://') || data.startsWith('https://'))
          ? data
          : data?.url ?? data?.gifUrl
      if (urlToInsert && typeof urlToInsert === 'string') {
        window.removeEventListener('message', handler)
        gifbuddyPopupRef.current = null
        onSelect?.(urlToInsert)
        setOpen(false)
      }
    }
    window.addEventListener('message', handler)
    const t = setTimeout(() => {
      window.removeEventListener('message', handler)
      gifbuddyPopupRef.current = null
    }, 10 * 60 * 1000)
    if (w) w.addEventListener('beforeunload', () => { clearTimeout(t); window.removeEventListener('message', handler) })
  }, [searchInput, onSelect])

  const descriptionForPublish = publishDescription.trim()

  /** Insert pasted GIF URL and publish kind 1063 so it's added to Nostr GIF library. */
  const handlePasteUrlInsert = useCallback(async () => {
    const url = pasteUrl.trim()
    if (!url || !/^https?:\/\//i.test(url)) return
    onSelect?.(url)
    setPasteUrl('')
    setOpen(false)
    if (pubkey) {
      setPublishingPaste(true)
      try {
        const draft = {
          kind: ExtendedKind.FILE_METADATA,
          content: descriptionForPublish,
          tags: [
            ['url', url],
            ['m', 'image/gif'],
            ['t', 'gif']
          ],
          created_at: Math.floor(Date.now() / 1000)
        }
        const writeUrls = [...GIF_RELAY_URLS, ...userWriteRelays]
        const seen = new Set<string>()
        const specifiedRelayUrls = writeUrls.filter((u) => {
          const n = (normalizeUrl(u) ?? u).toLowerCase()
          if (seen.has(n)) return false
          seen.add(n)
          return true
        })
        await publish(draft, { specifiedRelayUrls })
        setPublishDescription('')
      } catch {
        // ignore; URL was still inserted
      } finally {
        setPublishingPaste(false)
      }
    }
  }, [pasteUrl, pubkey, onSelect, publish, userWriteRelays, descriptionForPublish])

  /** In drawer mode we constrain height and make only the GIF grid scroll so the drawer doesn't "sink" */
  const isDrawer = isSmallScreen
  const content = (
    <div
      className={`flex flex-col gap-2 p-2 ${isDrawer ? 'w-full h-[70vh] max-h-[70vh] overflow-hidden' : 'min-w-[280px] max-w-[360px]'}`}
    >
      <div className="flex items-center gap-1 shrink-0">
        <Input
          placeholder={t('Search GIFs')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 size-8"
          onClick={() => setOpen(false)}
          aria-label={t('Close')}
        >
          <X className="size-4" />
        </Button>
      </div>
      {error && (
        <p className="text-sm text-muted-foreground px-1 shrink-0">{error}</p>
      )}
      <div
        className={isDrawer ? 'flex-1 min-h-0 flex flex-col' : undefined}
        {...(isDrawer && { 'data-vaul-no-drag': true })}
      >
        <ScrollArea
          className={
            isDrawer
              ? 'flex-1 min-h-[200px] w-full rounded-md border'
              : 'h-[280px] w-full rounded-md border'
          }
        >
          {loading ? (
            <div className="flex items-center justify-center h-full min-h-[200px]">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1 p-2">
              {gifs.map((gif) => (
                <button
                  key={gif.eventId}
                  type="button"
                  className="rounded overflow-hidden border border-transparent hover:border-primary focus:border-primary focus:outline-none aspect-square"
                  onClick={() => handleSelect(gif)}
                >
                  <img
                    src={gif.url}
                    alt="GIF"
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      const el = e.target as HTMLImageElement
                      el.style.display = 'none'
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
      <div className="flex flex-col gap-2 border-t pt-2 shrink-0">
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={openGifBuddySearch}
          >
            <ExternalLink className="size-3.5 mr-1.5" />
            {t('Search on GifBuddy')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('Opens in a new tab. Copy a GIF URL there, then paste below. If this picker closed, click “Insert GIF” again to paste.')}
          </p>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">
              {t('Paste URL of a GIF')}
            </Label>
            <div className="flex gap-1">
              <Input
                placeholder="https://..."
                value={pasteUrl}
                onChange={(e) => setPasteUrl(e.target.value)}
                className="flex-1 min-w-0"
              />
              <Button
                type="button"
                size="sm"
                disabled={!pasteUrl.trim() || publishingPaste}
                onClick={handlePasteUrlInsert}
                title={t('Insert URL into your post and publish to Nostr GIF library (NIP-94).')}
              >
                {publishingPaste ? t('Adding…') : t('Insert')}
              </Button>
            </div>
          </div>
        </div>
        {isLoggedIn && (
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">
              {t('Description (optional, for search)')}
            </Label>
            <Input
              placeholder={t('e.g. happy birthday, thumbs up')}
              value={publishDescription}
              onChange={(e) => setPublishDescription(e.target.value)}
              className="min-w-0"
            />
          </div>
        )}
        {isLoggedIn && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".gif,image/gif"
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={uploading}
              onClick={triggerFileUpload}
            >
              {uploading ? t('Uploading...') : t('Add your own GIFs')}
            </Button>
            {uploadError && (
              <p className="text-xs text-destructive text-center">{uploadError}</p>
            )}
          </>
        )}
      </div>
    </div>
  )

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent portalContainer={portalContainer}>
          <DrawerHeader className="sr-only">
            <DrawerTitle>{t('Choose a GIF')}</DrawerTitle>
          </DrawerHeader>
          {content}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="p-0" portalContainer={portalContainer}>
        {content}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
