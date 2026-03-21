import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { MouseEventHandler } from 'react'

export default function BottomNavigationBarItem({
  children,
  active = false,
  prominent = false,
  onClick
}: {
  children: React.ReactNode
  active?: boolean
  /** Slightly larger icon (e.g. favorites feed). */
  prominent?: boolean
  onClick: MouseEventHandler
}) {
  return (
    <Button
      className={cn(
        'flex shadow-none items-center bg-transparent w-full h-12 p-3 m-0 rounded-lg [&_svg]:size-6',
        prominent &&
          'h-[3.25rem] min-w-[3.25rem] [&_svg]:h-[1.85rem] [&_svg]:w-[1.85rem] [&_svg]:shrink-0',
        prominent &&
          'text-green-600 opacity-[0.82] hover:opacity-100 hover:text-green-600 dark:text-green-500 dark:hover:text-green-500',
        prominent && active && 'opacity-100 ring-2 ring-green-500/45 ring-offset-2 ring-offset-background dark:ring-green-400/50',
        active && !prominent && 'text-primary hover:text-primary'
      )}
      variant="ghost"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
