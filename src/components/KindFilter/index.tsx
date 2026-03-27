import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ExtendedKind, PROFILE_FEED_KINDS } from '@/constants'
import { cn } from '@/lib/utils'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ListFilter } from 'lucide-react'
import { kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const KIND_1 = kinds.ShortTextNote
const KIND_1111 = ExtendedKind.COMMENT

const KIND_FILTER_OPTIONS = [
  { kindGroup: [kinds.LongFormArticle], label: 'Articles' },
  { kindGroup: [ExtendedKind.WIKI_ARTICLE, ExtendedKind.WIKI_ARTICLE_MARKDOWN], label: 'Wiki Articles' },
  { kindGroup: [kinds.Highlights], label: 'Highlights' },
  { kindGroup: [ExtendedKind.POLL], label: 'Polls' },
  { kindGroup: [ExtendedKind.ZAP_POLL], label: 'Zap polls' },
  { kindGroup: [ExtendedKind.VOICE, ExtendedKind.VOICE_COMMENT], label: 'Voice Posts' },
  { kindGroup: [ExtendedKind.PICTURE], label: 'Photo Posts' },
  { kindGroup: [ExtendedKind.VIDEO, ExtendedKind.SHORT_VIDEO], label: 'Video Posts' },
  { kindGroup: [ExtendedKind.DISCUSSION], label: 'Discussions' },
  { kindGroup: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME], label: 'Calendar Events' },
  { kindGroup: [ExtendedKind.ZAP_RECEIPT], label: 'Zaps' },
  { kindGroup: [kinds.Repost, ExtendedKind.GENERIC_REPOST], label: 'Boosts' }
]

function buildShowKindsFromOptions(
  baseKinds: number[],
  showKind1OPs: boolean,
  showKind1Replies: boolean,
  showKind1111: boolean
): number[] {
  const rest = baseKinds.filter((k) => k !== KIND_1 && k !== KIND_1111)
  const out = [...rest]
  if (showKind1OPs || showKind1Replies) out.push(KIND_1)
  if (showKind1111) out.push(KIND_1111)
  return out.sort((a, b) => a - b)
}

export default function KindFilter({
  showKinds,
  onShowKindsChange
}: {
  showKinds: number[]
  onShowKindsChange: (kinds: number[]) => void
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const {
    showKinds: savedShowKinds,
    showKind1OPs: savedShowKind1OPs,
    showKind1Replies: savedShowKind1Replies,
    showKind1111: savedShowKind1111,
    feedKindFilterBypass,
    updateShowKinds,
    updateFeedKindFilterBypass
  } = useKindFilter()
  const [open, setOpen] = useState(false)
  const [temporaryShowKinds, setTemporaryShowKinds] = useState(showKinds)
  const [temporaryShowKind1OPs, setTemporaryShowKind1OPs] = useState(savedShowKind1OPs)
  const [temporaryShowKind1Replies, setTemporaryShowKind1Replies] = useState(savedShowKind1Replies)
  const [temporaryShowKind1111, setTemporaryShowKind1111] = useState(savedShowKind1111)
  const [temporarySeeAllEvents, setTemporarySeeAllEvents] = useState(feedKindFilterBypass)
  const [isPersistent, setIsPersistent] = useState(true)
  const isDifferentFromSaved = useMemo(
    () => !isSameKindFilter(showKinds, savedShowKinds),
    [showKinds, savedShowKinds]
  )
  const isTemporaryDifferentFromSaved = useMemo(
    () =>
      !isSameKindFilter(temporaryShowKinds, savedShowKinds) ||
      temporaryShowKind1OPs !== savedShowKind1OPs ||
      temporaryShowKind1Replies !== savedShowKind1Replies ||
      temporaryShowKind1111 !== savedShowKind1111 ||
      temporarySeeAllEvents !== feedKindFilterBypass,
    [
      temporaryShowKinds,
      savedShowKinds,
      temporaryShowKind1OPs,
      temporaryShowKind1Replies,
      temporaryShowKind1111,
      temporarySeeAllEvents,
      savedShowKind1OPs,
      savedShowKind1Replies,
      savedShowKind1111,
      feedKindFilterBypass
    ]
  )

  useEffect(() => {
    if (open) {
      setTemporaryShowKinds(showKinds)
      setTemporaryShowKind1OPs(savedShowKind1OPs)
      setTemporaryShowKind1Replies(savedShowKind1Replies)
      setTemporaryShowKind1111(savedShowKind1111)
      setTemporarySeeAllEvents(feedKindFilterBypass)
      setIsPersistent(true)
    }
  }, [
    open,
    showKinds,
    savedShowKind1OPs,
    savedShowKind1Replies,
    savedShowKind1111,
    feedKindFilterBypass
  ])

  const appliedShowKinds = useMemo(
    () =>
      buildShowKindsFromOptions(
        temporaryShowKinds,
        temporaryShowKind1OPs,
        temporaryShowKind1Replies,
        temporaryShowKind1111
      ),
    [temporaryShowKinds, temporaryShowKind1OPs, temporaryShowKind1Replies, temporaryShowKind1111]
  )
  const canApply = temporarySeeAllEvents || appliedShowKinds.length > 0

  const handleApply = () => {
    if (!canApply) return

    updateFeedKindFilterBypass(temporarySeeAllEvents, { persist: isPersistent })

    if (temporarySeeAllEvents) {
      setOpen(false)
      onShowKindsChange(showKinds)
      return
    }

    const newShowKinds = appliedShowKinds
    if (!isSameKindFilter(newShowKinds, showKinds)) {
      onShowKindsChange(newShowKinds)
    }
    updateShowKinds(newShowKinds, {
      showKind1OPs: temporaryShowKind1OPs,
      showKind1Replies: temporaryShowKind1Replies,
      showKind1111: temporaryShowKind1111,
      persist: isPersistent
    })
    setOpen(false)
  }

  const trigger = (
    <Button
      variant="ghost"
      size="titlebar-icon"
      className={cn(
        'relative w-fit px-2 h-8 text-xs focus:text-foreground',
        !isDifferentFromSaved && !feedKindFilterBypass && 'text-muted-foreground',
        feedKindFilterBypass && 'text-amber-600 dark:text-amber-400'
      )}
      onClick={() => {
        if (isSmallScreen) {
          setOpen(true)
        }
      }}
    >
      <ListFilter className="size-2.5" />
      <span className="ml-1 text-xs">{t('Filter')}</span>
      {isDifferentFromSaved && (
        <div className="absolute size-1.5 rounded-full bg-primary left-6 top-1.5 ring-1 ring-background" />
      )}
    </Button>
  )

  const content = (
    <div>
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 mb-3">
        <span className="text-sm shrink-0">{t('Use filter')}</span>
        <Switch
          checked={temporarySeeAllEvents}
          onCheckedChange={setTemporarySeeAllEvents}
          aria-label={temporarySeeAllEvents ? t('See all events') : t('Use filter')}
        />
        <span className="text-sm shrink-0 text-right">{t('See all events')}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {temporarySeeAllEvents ? t('See all events hint') : t('Use filter hint')}
      </p>
      <div className={cn('grid grid-cols-2 gap-2', temporarySeeAllEvents && 'opacity-50')}>
        {/* Posts (OPs) - kind 1 top-level only */}
        <div
          className={cn(
            'cursor-pointer grid gap-1.5 rounded-lg border px-4 py-3',
            temporaryShowKind1OPs ? 'border-primary/60 bg-primary/5' : 'clickable'
          )}
          onClick={() => setTemporaryShowKind1OPs((prev) => !prev)}
        >
          <p className="leading-none font-medium">{t('Posts (OPs)')}</p>
          <p className="text-muted-foreground text-xs">kind {KIND_1}</p>
        </div>
        {/* Kind 1 replies - kind 1 that are replies */}
        <div
          className={cn(
            'cursor-pointer grid gap-1.5 rounded-lg border px-4 py-3',
            temporaryShowKind1Replies ? 'border-primary/60 bg-primary/5' : 'clickable'
          )}
          onClick={() => setTemporaryShowKind1Replies((prev) => !prev)}
        >
          <p className="leading-none font-medium">{t('Kind 1 replies')}</p>
          <p className="text-muted-foreground text-xs">kind {KIND_1}</p>
        </div>
        {/* Comments - kind 1111 */}
        <div
          className={cn(
            'cursor-pointer grid gap-1.5 rounded-lg border px-4 py-3',
            temporaryShowKind1111 ? 'border-primary/60 bg-primary/5' : 'clickable'
          )}
          onClick={() => setTemporaryShowKind1111((prev) => !prev)}
        >
          <p className="leading-none font-medium">{t('Comments')}</p>
          <p className="text-muted-foreground text-xs">kind {KIND_1111}</p>
        </div>
        {KIND_FILTER_OPTIONS.map(({ kindGroup, label }) => {
          const checked = kindGroup.every((k) => temporaryShowKinds.includes(k))
          return (
            <div
              key={kindGroup.join('-')}
              className={cn(
                'cursor-pointer grid gap-1.5 rounded-lg border px-4 py-3',
                checked ? 'border-primary/60 bg-primary/5' : 'clickable'
              )}
              onClick={() => {
                if (!checked) {
                  setTemporaryShowKinds((prev) => Array.from(new Set([...prev, ...kindGroup])))
                } else {
                  setTemporaryShowKinds((prev) => prev.filter((k) => !kindGroup.includes(k)))
                }
              }}
            >
              <p className="leading-none font-medium">{t(label)}</p>
              <p className="text-muted-foreground text-xs">kind {kindGroup.join(', ')}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 mt-4">
        <Button
          variant="secondary"
          onClick={() => {
            setTemporaryShowKinds(
              PROFILE_FEED_KINDS.filter((k) => k !== KIND_1 && k !== KIND_1111)
            )
            setTemporaryShowKind1OPs(true)
            setTemporaryShowKind1Replies(true)
            setTemporaryShowKind1111(true)
          }}
        >
          {t('Select All')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setTemporaryShowKinds([])
            setTemporaryShowKind1OPs(false)
            setTemporaryShowKind1Replies(false)
            setTemporaryShowKind1111(false)
          }}
        >
          {t('Clear All')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setTemporaryShowKinds(savedShowKinds)
            setTemporaryShowKind1OPs(savedShowKind1OPs)
            setTemporaryShowKind1Replies(savedShowKind1Replies)
            setTemporaryShowKind1111(savedShowKind1111)
            setTemporarySeeAllEvents(feedKindFilterBypass)
          }}
          disabled={!isTemporaryDifferentFromSaved}
        >
          {t('Reset')}
        </Button>
      </div>

      <Label className="flex items-center gap-2 cursor-pointer mt-4">
        <Checkbox
          id="persistent-filter"
          checked={isPersistent}
          onCheckedChange={(checked) => setIsPersistent(!!checked)}
        />
        <span className="text-sm">{t('Set as default filter')}</span>
      </Label>

      <Button
        onClick={handleApply}
        className="mt-4 w-full"
        disabled={!canApply}
      >
        {t('Apply')}
      </Button>
    </div>
  )

  if (isSmallScreen) {
    return (
      <>
        {trigger}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild></DrawerTrigger>
          <DrawerContent className="px-4">
            <DrawerHeader className="sr-only">
              <DrawerTitle>Filter</DrawerTitle>
            </DrawerHeader>
            {content}
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-96" collisionPadding={16} sideOffset={0}>
        {content}
      </PopoverContent>
    </Popover>
  )
}

function isSameKindFilter(a: number[], b: number[]) {
  if (a.length !== b.length) {
    return false
  }
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}
