import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useNostr } from '@/providers/NostrProvider'
import { ExtendedKind, GIF_RELAY_URLS } from '@/constants'
import { fetchGifs, searchGifs, type GifMetadata } from '@/services/gif.service'
import mediaUpload from '@/services/media-upload.service'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const GIFBUDDY_URL = 'https://www.gifbuddy.lol/'

export default function GifPicker({
  children,
  onSelect
}: {
  children: React.ReactNode
  onSelect?: (gifUrl: string) => void
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { publish, pubkey } = useNostr()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [gifs, setGifs] = useState<GifMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadGifs = useCallback(async (q: string, forceRefresh = false) => {
    setError(null)
    setLoading(true)
    try {
      const results = q.trim()
        ? await searchGifs(q.trim(), 50, forceRefresh)
        : await fetchGifs(undefined, 50, forceRefresh)
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
  }, [t])

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
    const files = e.target.files
    if (!files?.length || !pubkey) return
    setUploadError(null)
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        if (!file.type.includes('gif') && !file.name.toLowerCase().endsWith('.gif')) {
          setUploadError(t('{{name}} is not a GIF file', { name: file.name }))
          continue
        }
        const { url } = await mediaUpload.upload(file)
        const draft = {
          kind: ExtendedKind.FILE_METADATA,
          content: '',
          tags: [
            ['file', url, file.type || 'image/gif', `size ${file.size}`],
            ['url', url],
            ['m', file.type || 'image/gif'],
            ['t', 'gif']
          ],
          created_at: Math.floor(Date.now() / 1000)
        }
        await publish(draft, { specifiedRelayUrls: GIF_RELAY_URLS })
      }
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

  const content = (
    <div className="flex flex-col gap-2 p-2 min-w-[280px] max-w-[360px]">
      <div className="flex gap-1">
        <Input
          placeholder={t('Search GIFs')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1"
        />
      </div>
      {error && (
        <p className="text-sm text-muted-foreground px-1">{error}</p>
      )}
      <ScrollArea className="h-[280px] w-full rounded-md border">
        {loading ? (
          <div className="flex items-center justify-center h-full">
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
      <div className="flex flex-col gap-2 border-t pt-2">
        <a
          href={GIFBUDDY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:underline text-center"
        >
          {t('Search GifBuddy for more GIFs')}
        </a>
        {isLoggedIn && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".gif,image/gif"
              multiple
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
        <DrawerContent>
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
      <DropdownMenuContent side="top" className="p-0">
        {content}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
