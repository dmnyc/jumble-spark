import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ExtendedKind, SUPPORTED_KINDS } from '@/constants'
import { cn } from '@/lib/utils'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ListFilter } from 'lucide-react'
import { kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const KIND_FILTER_OPTIONS = [
  { kindGroup: [kinds.ShortTextNote, ExtendedKind.COMMENT], label: 'Posts' },
  { kindGroup: [kinds.Repost], label: 'Reposts' },
  { kindGroup: [kinds.LongFormArticle], label: 'Articles' },
  { kindGroup: [ExtendedKind.PUBLICATION], label: 'Publications' },
  { kindGroup: [ExtendedKind.WIKI_ARTICLE, ExtendedKind.WIKI_ARTICLE_MARKDOWN], label: 'Wiki Articles' },
  { kindGroup: [kinds.Highlights], label: 'Highlights' },
  { kindGroup: [ExtendedKind.POLL], label: 'Polls' },
  { kindGroup: [ExtendedKind.VOICE, ExtendedKind.VOICE_COMMENT], label: 'Voice Posts' },
  { kindGroup: [ExtendedKind.PICTURE], label: 'Photo Posts' },
  { kindGroup: [ExtendedKind.VIDEO, ExtendedKind.SHORT_VIDEO], label: 'Video Posts' },
  { kindGroup: [ExtendedKind.DISCUSSION], label: 'Discussions' },
  { kindGroup: [ExtendedKind.ZAP_RECEIPT], label: 'Zaps' }
]

export default function KindFilter({
  showKinds,
  onShowKindsChange
}: {
  showKinds: number[]
  onShowKindsChange: (kinds: number[]) => void
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { showKinds: savedShowKinds } = useKindFilter()
  const [open, setOpen] = useState(false)
  const { updateShowKinds } = useKindFilter()
  const [temporaryShowKinds, setTemporaryShowKinds] = useState(showKinds)
  const [isPersistent, setIsPersistent] = useState(false)
  const isDifferentFromSaved = useMemo(
    () => !isSameKindFilter(showKinds, savedShowKinds),
    [showKinds, savedShowKinds]
  )
  const isTemporaryDifferentFromSaved = useMemo(
    () => !isSameKindFilter(temporaryShowKinds, savedShowKinds),
    [temporaryShowKinds, savedShowKinds]
  )

  useEffect(() => {
    setTemporaryShowKinds(showKinds)
    setIsPersistent(false)
  }, [open])

  const handleApply = () => {
    if (temporaryShowKinds.length === 0) {
      // must select at least one kind
      return
    }

    const newShowKinds = [...temporaryShowKinds].sort()
    if (!isSameKindFilter(newShowKinds, showKinds)) {
      onShowKindsChange(newShowKinds)
    }

    if (isPersistent) {
      updateShowKinds(newShowKinds)
    }

    setIsPersistent(false)
    setOpen(false)
  }

  const trigger = (
    <Button
      variant="ghost"
      size="titlebar-icon"
      className={cn(
        'relative w-fit px-2 h-8 text-xs focus:text-foreground',
        !isDifferentFromSaved && 'text-muted-foreground'
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
      <div className="grid grid-cols-2 gap-2">
        {KIND_FILTER_OPTIONS.map(({ kindGroup, label }) => {
          const checked = kindGroup.every((k) => temporaryShowKinds.includes(k))
          return (
            <div
              key={label}
              className={cn(
                'cursor-pointer grid gap-1.5 rounded-lg border px-4 py-3',
                checked ? 'border-primary/60 bg-primary/5' : 'clickable'
              )}
              onClick={() => {
                if (!checked) {
                  // add all kinds in this group
                  setTemporaryShowKinds((prev) => Array.from(new Set([...prev, ...kindGroup])))
                } else {
                  // remove all kinds in this group
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
            // Select all supported kinds except reposts (matching default behavior)
            setTemporaryShowKinds(SUPPORTED_KINDS.filter(kind => kind !== kinds.Repost))
          }}
        >
          {t('Select All')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setTemporaryShowKinds([])
          }}
        >
          {t('Clear All')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setTemporaryShowKinds(savedShowKinds)}
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
        disabled={temporaryShowKinds.length === 0}
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
