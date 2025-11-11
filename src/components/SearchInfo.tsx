import { Info } from 'lucide-react'
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
        <h4 className="font-semibold mb-2">Advanced Search Parameters</h4>
        <div className="space-y-2 text-sm">
          <div>
            <strong>Plain text:</strong> Searches by d-tag for replaceable events (normalized, hyphenated)
          </div>
          <div>
            <strong>Date ranges:</strong>
            <ul className="ml-4 mt-1 space-y-1 list-disc">
              <li><code className="text-xs">YYYY-MM-DD to YYYY-MM-DD</code> - Date range (e.g., <code className="text-xs">2025-10-23 to 2025-10-30</code>)</li>
              <li><code className="text-xs">from:YYYY-MM-DD</code> - Events from this date</li>
              <li><code className="text-xs">to:YYYY-MM-DD</code> - Events until this date</li>
              <li><code className="text-xs">before:YYYY-MM-DD</code> - Events before this date</li>
              <li><code className="text-xs">after:YYYY-MM-DD</code> - Events after this date</li>
              <li>Supports 2-digit years (e.g., <code className="text-xs">25-10-23</code> = <code className="text-xs">2025-10-23</code>)</li>
            </ul>
          </div>
          <div>
            <strong>Filters:</strong>
            <ul className="ml-4 mt-1 space-y-1 list-disc">
              <li><code className="text-xs">t:hashtag</code> or <code className="text-xs">hashtag:hashtag</code> - Filter by hashtag (t-tag)</li>
              <li><code className="text-xs">pubkey:npub...</code>, <code className="text-xs">pubkey:hex</code>, <code className="text-xs">pubkey:nprofile...</code>, or <code className="text-xs">pubkey:user@domain.com</code> - Filter by pubkey (accepts npub, nprofile, hex, or NIP-05)</li>
              <li><code className="text-xs">events:hex</code>, <code className="text-xs">events:note1...</code>, <code className="text-xs">events:nevent1...</code>, or <code className="text-xs">events:naddr1...</code> - Filter by specific events (accepts hex, note, nevent, or naddr)</li>
              <li><code className="text-xs">kind:30023</code> - Filter by event kind (e.g., 1=notes, 30023=articles, 30817/30818=wiki)</li>
              <li>Multiple values supported: <code className="text-xs">t:bitcoin,nostr</code>, <code className="text-xs">pubkey:npub1...,npub2...</code> or <code className="text-xs">kind:30023,2018</code></li>
            </ul>
          </div>
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              <strong>Examples:</strong>
            </p>
            <ul className="ml-4 mt-1 space-y-1 list-disc text-xs text-muted-foreground">
              <li><code>jumble search</code> → searches d-tag</li>
              <li><code>t:bitcoin from:2024-01-01</code></li>
              <li><code>pubkey:npub1abc... from:2024-01-01</code></li>
              <li><code>kind:30023 from:2024-01-01</code></li>
              <li><code>2025-10-23 to 2025-10-30</code> → date range</li>
            </ul>
          </div>
        </div>
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

