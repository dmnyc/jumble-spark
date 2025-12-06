import { Sheet, SheetContent } from '@/components/ui/sheet'
import NotePage from '@/pages/secondary/NotePage'

interface NoteDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  noteId: string | null
}

export default function NoteDrawer({ open, onOpenChange, noteId }: NoteDrawerProps) {
  if (!noteId) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[1042px] overflow-y-auto p-0">
        <div className="h-full">
          <NotePage id={noteId} index={0} hideTitlebar={false} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
