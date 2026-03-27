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
import { Skeleton } from '@/components/ui/skeleton'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useNostr } from '@/providers/NostrProvider'
import { ExtendedKind, GIF_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import {
  fetchMemes,
  mergeMemesIntoIdbCache,
  memeMetadataFrom1063Event,
  searchMemes,
  type MemeMetadata
} from '@/services/meme.service'
import mediaUpload from '@/services/media-upload.service'
import { ExternalLink, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const MEMEAMIGO_URL = 'https://www.memeamigo.lol/'
const MEMEAMIGO_SEARCH_URL = (q: string) =>
  q.trim() ? `${MEMEAMIGO_URL}?q=${encodeURIComponent(q.trim())}` : MEMEAMIGO_URL

function mimeFromImageUrl(url: string): string {
  const lower = url.toLowerCase().split('?')[0] ?? ''
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/jpeg'
}

function isStaticImageFile(file: File): boolean {
  const n = file.name.toLowerCase()
  const t = file.type.toLowerCase()
  return (
    t === 'image/jpeg' ||
    t === 'image/png' ||
    t === 'image/webp' ||
    n.endsWith('.jpg') ||
    n.endsWith('.jpeg') ||
    n.endsWith('.png') ||
    n.endsWith('.webp')
  )
}

export default function MemePicker({
  children,
  onSelect,
  portalContainer
}: {
  children: React.ReactNode
  onSelect?: (imageUrl: string) => void
  portalContainer?: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { publish, pubkey, relayList } = useNostr()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [memes, setMemes] = useState<MemeMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pasteUrl, setPasteUrl] = useState('')
  const [publishingPaste, setPublishingPaste] = useState(false)
  const [publishDescription, setPublishDescription] = useState('')
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const memeamigoPopupRef = useRef<Window | null>(null)

  const userReadRelays = relayList?.read ?? []
  const userWriteRelays = relayList?.write ?? []

  const loadMemes = useCallback(
    async (q: string, forceRefresh = false) => {
      setError(null)
      setLoading(true)
      try {
        const results = q.trim()
          ? await searchMemes(q.trim(), 50, forceRefresh, userReadRelays, pubkey ?? null)
          : await fetchMemes(undefined, 50, forceRefresh, userReadRelays, pubkey ?? null)
        setMemes(results)
        if (results.length === 0 && !q.trim()) {
          setError(
            t(
              'No meme templates found. Try searching or open Meme Amigo. The grid only lists kind 1063 (NIP-94) files tagged memeamigo (not random photos from notes).'
            )
          )
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load memes')
        setMemes([])
      } finally {
        setLoading(false)
      }
    },
    [t, userReadRelays, pubkey]
  )

  useEffect(() => {
    if (!open) return
    loadMemes(query)
  }, [open, query, loadMemes])

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

  const handleSelect = (meme: MemeMetadata) => {
    const url = meme.fallbackUrl || meme.url
    onSelect?.(url)
    setOpen(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !pubkey) return
    setUploadError(null)
    setUploading(true)
    try {
      if (!isStaticImageFile(file)) {
        setUploadError(t('{{name}} is not a JPEG, PNG, or WebP file', { name: file.name }))
        return
      }
      const { url } = await mediaUpload.upload(file)
      const mime = file.type || mimeFromImageUrl(url)
      const draft = {
        kind: ExtendedKind.FILE_METADATA,
        content: publishDescription.trim(),
        tags: [
          ['file', url, mime, `size ${file.size}`],
          ['url', url],
          ['m', mime],
          ['t', 'memeamigo']
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
      const published = await publish(draft, { specifiedRelayUrls })
      const meta = memeMetadataFrom1063Event(published)
      if (meta) {
        await mergeMemesIntoIdbCache([meta])
        setMemes((prev) => {
          const next = [meta, ...prev.filter((m) => m.eventId !== meta.eventId)]
          return next.slice(0, 50)
        })
      }
      setPublishDescription('')
      setQuery('')
      await loadMemes('', false)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const triggerFileUpload = () => fileInputRef.current?.click()

  const isLoggedIn = !!pubkey

  const openMemeAmigoSearch = useCallback(() => {
    const url = MEMEAMIGO_SEARCH_URL(searchInput)
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    memeamigoPopupRef.current = w ?? null
    const handler = (event: MessageEvent) => {
      if (
        event.origin !== 'https://www.memeamigo.lol' &&
        event.origin !== 'https://memeamigo.lol'
      ) {
        return
      }
      const data = event.data
      const urlToInsert =
        typeof data === 'string' && (data.startsWith('http://') || data.startsWith('https://'))
          ? data
          : data?.url ?? data?.imageUrl
      if (urlToInsert && typeof urlToInsert === 'string') {
        window.removeEventListener('message', handler)
        memeamigoPopupRef.current = null
        onSelect?.(urlToInsert)
        setOpen(false)
      }
    }
    window.addEventListener('message', handler)
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler)
      memeamigoPopupRef.current = null
    }, 10 * 60 * 1000)
    if (w)
      w.addEventListener('beforeunload', () => {
        clearTimeout(timer)
        window.removeEventListener('message', handler)
      })
  }, [searchInput, onSelect])

  const descriptionForPublish = publishDescription.trim()

  const handlePasteUrlInsert = useCallback(async () => {
    const url = pasteUrl.trim()
    if (!url || !/^https?:\/\//i.test(url)) return
    onSelect?.(url)
    setPasteUrl('')
    setOpen(false)
    if (pubkey) {
      setPublishingPaste(true)
      try {
        const mime = mimeFromImageUrl(url)
        const draft = {
          kind: ExtendedKind.FILE_METADATA,
          content: descriptionForPublish,
          tags: [
            ['file', url, mime, 'size 0'],
            ['url', url],
            ['m', mime],
            ['t', 'memeamigo']
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
        const published = await publish(draft, { specifiedRelayUrls })
        const meta = memeMetadataFrom1063Event(published)
        if (meta) {
          await mergeMemesIntoIdbCache([meta])
        }
        setPublishDescription('')
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t('Failed to publish meme template for the picker')
        )
      } finally {
        setPublishingPaste(false)
      }
    }
  }, [pasteUrl, pubkey, onSelect, publish, userWriteRelays, descriptionForPublish])

  const isDrawer = isSmallScreen
  const content = (
    <div
      className={`flex flex-col gap-2 p-2 ${isDrawer ? 'w-full h-[70vh] max-h-[70vh] overflow-hidden' : 'min-w-[280px] max-w-[360px]'}`}
    >
      <div className="flex items-center gap-1 shrink-0">
        <Input
          placeholder={t('Search memes')}
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
      {error && <p className="text-sm text-muted-foreground px-1 shrink-0">{error}</p>}
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
            <div
              className="grid grid-cols-2 gap-1 p-2 min-h-[200px]"
              role="status"
              aria-busy="true"
              aria-live="polite"
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square w-full rounded" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1 p-2">
              {memes.map((meme) => (
                <button
                  key={meme.eventId}
                  type="button"
                  className="rounded overflow-hidden border border-transparent hover:border-primary focus:border-primary focus:outline-none aspect-square"
                  onClick={() => handleSelect(meme)}
                >
                  <img
                    src={meme.url}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      const el = e.target as HTMLImageElement
                      const fallback = meme.fallbackUrl?.trim()
                      if (fallback && el.dataset.memeFallbackTried !== '1') {
                        el.dataset.memeFallbackTried = '1'
                        el.src = fallback
                        return
                      }
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
            onClick={openMemeAmigoSearch}
          >
            <ExternalLink className="size-3.5 mr-1.5" />
            {t('Search on Meme Amigo')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t(
              'Opens in a new tab. Copy an image URL there, then paste below. If this picker closed, click “Insert meme” again to paste.'
            )}
          </p>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">
              {t('Paste URL of a meme image')}
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
                title={t(
                  'Insert URL into your post and publish kind 1063 (NIP-94) with hashtag memeamigo for discoverability.'
                )}
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
              placeholder={t('e.g. drake, distracted boyfriend')}
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
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
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
              {uploading ? t('Uploading...') : t('Add your own meme templates')}
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
            <DrawerTitle>{t('Choose a meme')}</DrawerTitle>
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
