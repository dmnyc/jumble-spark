import { Info, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from '@/components/ui/drawer'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { cn } from '@/lib/utils'

export default function SearchInfo() {
  const { isSmallScreen } = useScreenSize()

  const searchInfoContent = (
    <div className="space-y-3">
      <div>
        <h4 className="font-semibold mb-2">Search Parameters</h4>
        <div className="space-y-2 text-sm">
          <div>
            <strong>Plain text:</strong> Searches by d-tag for replaceable events (normalized, hyphenated)
          </div>
          <div>
            <strong>Event IDs:</strong> Bare event IDs work as standard search (hex, note1, nevent1, naddr1)
          </div>
          <div>
            <strong>Filters:</strong>
            <ul className="ml-4 mt-1 space-y-1 list-disc">
              <li><code className="text-xs">t:hashtag</code> or <code className="text-xs">hashtag:hashtag</code> - Filter by hashtag (t-tag)</li>
              <li>Multiple values supported: <code className="text-xs">t:bitcoin,nostr</code></li>
            </ul>
          </div>
          <div>
            <strong>Kind filter:</strong> Use URL parameter <code className="text-xs">k=</code> with other filters (e.g., <code className="text-xs">?t=bitcoin&k=1</code> or <code className="text-xs">?t=testfile&k=30023</code>). Cannot be used alone.
          </div>
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              <strong>Examples:</strong>
            </p>
            <ul className="ml-4 mt-1 space-y-1 list-disc text-xs text-muted-foreground">
              <li><code>jumble search</code> → searches d-tag</li>
              <li><code>t:bitcoin</code> → hashtag search</li>
              <li><code>note1abc...</code> → searches for event ID</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="pt-2 border-t">
        <a
          href="https://next-alexandria.gitcitadel.eu/events"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <BookOpen className="h-4 w-4" />
          <span>Advanced search on Alexandria</span>
        </a>
      </div>
    </div>
  )

  if (isSmallScreen) {
    return (
      <Drawer>
        <DrawerTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground border border-border/50 hover:border-border rounded-md relative z-10")}
            title="Search help"
          >
            <Info className="h-4 w-4" />
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Advanced Search Help</DrawerTitle>
            <DrawerDescription>
              Learn about available search parameters
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 max-h-[60vh] overflow-y-auto">
            {searchInfoContent}
          </div>
          <div className="px-4 pb-4 border-t">
            <a
              href="https://next-alexandria.gitcitadel.eu/events"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <BookOpen className="h-4 w-4" />
              <span>Advanced search on Alexandria</span>
            </a>
          </div>
          <DrawerClose asChild>
            <Button variant="outline" className="m-4">Close</Button>
          </DrawerClose>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground border border-border/50 hover:border-border rounded-md relative z-10")}
            title="Search help"
          >
            <Info className="h-4 w-4" />
          </Button>
      </HoverCardTrigger>
      <HoverCardContent className="w-96 max-h-[80vh] overflow-y-auto" side="left" align="start">
        <h3 className="font-semibold mb-3">Advanced Search Help</h3>
        {searchInfoContent}
      </HoverCardContent>
    </HoverCard>
  )
}

