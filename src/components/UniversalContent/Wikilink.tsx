import { useState } from 'react'
import { ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface WikilinkProps {
  dTag: string
  displayText: string
  className?: string
}

export default function Wikilink({ dTag, displayText, className }: WikilinkProps) {
  const [isOpen, setIsOpen] = useState(false)

  const handleAlexandriaClick = () => {
    const url = `https://next-alexandria.gitcitadel.eu/events?d=${dTag}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="link"
          className="p-0 h-auto text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
        >
          <span>{displayText}</span>
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">
        <div className="bg-muted/30 rounded-md p-2 text-xs space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs h-6"
            onClick={handleAlexandriaClick}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            View on Alexandria
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
