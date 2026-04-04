import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TEmoji } from '@/types'
import { useState } from 'react'
import EmojiPicker from '../EmojiPicker'

export default function EmojiPickerDialog({
  children,
  onEmojiClick,
  portalContainer
}: {
  children: React.ReactNode
  onEmojiClick?: (emoji: string | TEmoji | undefined) => void
  /** When set (e.g. inside a modal), picker content portals here so it stays on top of the modal */
  portalContainer?: HTMLElement | null
}) {
  const { isSmallScreen } = useScreenSize()
  const [open, setOpen] = useState(false)

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent
          portalContainer={portalContainer}
          className="max-h-[min(88dvh,calc(100dvh-5rem))] px-2"
          onPointerDownOutside={(e) => {
            const t = e.target as HTMLElement | null
            if (t?.closest?.('[data-vaul-overlay]')) return
            e.preventDefault()
          }}
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>Emoji Picker</DrawerTitle>
          </DrawerHeader>
          <div className="flex w-full max-w-[100vw] min-w-0 min-h-0 shrink flex-col items-stretch overflow-x-hidden pb-1">
            <EmojiPicker
              onEmojiClick={(emoji, e) => {
                e.stopPropagation()
                setOpen(false)
                onEmojiClick?.(emoji)
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        className="p-0 w-[min(100vw-1rem,350px)] max-w-[calc(100vw-1rem)] overflow-hidden"
        portalContainer={portalContainer}
      >
        <EmojiPicker
          onEmojiClick={(emoji, e) => {
            e.stopPropagation()
            setOpen(false)
            onEmojiClick?.(emoji)
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
