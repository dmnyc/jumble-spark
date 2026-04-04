import { cn } from '@/lib/utils'

export function Titlebar({
  children,
  className,
  hideBottomBorder = false
}: {
  children?: React.ReactNode
  className?: string
  hideBottomBorder?: boolean
}) {
  return (
    <div
      className={cn(
        'imwald-titlebar-fog sticky top-0 w-full h-12 z-40 bg-background [&_svg]:size-5 [&_svg]:shrink-0 select-none',
        !hideBottomBorder && 'border-b border-border',
        className
      )}
    >
      {children}
    </div>
  )
}
