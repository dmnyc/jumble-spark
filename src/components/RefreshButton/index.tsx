import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { RefreshCcw } from 'lucide-react'
import { useState } from 'react'

export function RefreshButton({ onClick }: { onClick: () => void }) {
  const [refreshing, setRefreshing] = useState(false)

  return (
    <Button
      variant="ghost"
      size="titlebar-icon"
      disabled={refreshing}
      onClick={() => {
        setRefreshing(true)
        onClick()
        setTimeout(() => setRefreshing(false), 500)
      }}
      className="text-muted-foreground focus:text-foreground [&_svg]:size-3 h-8 px-2 text-xs"
    >
      <RefreshCcw className={cn(refreshing ? 'animate-spin' : '')} />
    </Button>
  )
}
