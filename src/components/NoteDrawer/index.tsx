import { useState, useEffect, useRef } from 'react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import NotePage from '@/pages/secondary/NotePage'
import { useSecondaryPage } from '@/PageManager'
import type { Event } from 'nostr-tools'
import logger from '@/lib/logger'

interface NoteDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  noteId: string | null
  initialEvent?: Event | null
}

export default function NoteDrawer({ open, onOpenChange, noteId, initialEvent }: NoteDrawerProps) {
  const { currentIndex } = useSecondaryPage()
  const [displayNoteId, setDisplayNoteId] = useState<string | null>(noteId)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (noteId) {
      // New noteId - show immediately
      setDisplayNoteId(noteId)
    } else if (!open && displayNoteId) {
      // Closing - keep content visible during animation (350ms)
      timeoutRef.current = setTimeout(() => {
        setDisplayNoteId(null)
        timeoutRef.current = null
      }, 350)
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [noteId, open])

  if (!displayNoteId) return null

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        logger.info('[LightboxTrace][NoteDrawer] onOpenChange', {
          currentOpen: open,
          nextOpen,
          noteId: displayNoteId
        })
        onOpenChange(nextOpen)
      }}
      registerWithModalManager={false}
    >
      <SheetContent side="right" className="w-full sm:max-w-[1042px] overflow-y-auto p-0">
        <div className="min-h-full">
          <NotePage
            id={displayNoteId}
            index={currentIndex}
            hideTitlebar={false}
            initialEvent={initialEvent ?? undefined}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
