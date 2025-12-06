import { useState, useEffect, useRef } from 'react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import NotePage from '@/pages/secondary/NotePage'

interface NoteDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  noteId: string | null
}

export default function NoteDrawer({ open, onOpenChange, noteId }: NoteDrawerProps) {
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[1042px] overflow-y-auto p-0">
        <div className="h-full">
          <NotePage id={displayNoteId} index={0} hideTitlebar={false} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
