import { Button, ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

const SidebarItem = forwardRef<
  HTMLButtonElement,
  ButtonProps & { title: string; description?: string; active?: boolean }
>(({ children, title, description, className, active, ...props }, ref) => {
  const { t } = useTranslation()

  return (
    <Button
      className={cn(
        'flex shadow-none items-center transition-colors duration-500 bg-transparent w-12 h-12 xl:w-full xl:h-auto xl:min-w-0 p-3 m-0 xl:py-2 xl:pl-3 xl:pr-4 rounded-lg xl:justify-start gap-3 text-lg font-semibold [&_svg]:size-full xl:[&_svg]:size-4 xl:[&_svg]:shrink-0',
        active &&
          'text-primary hover:text-primary bg-primary/10 hover:bg-primary/10 xl:shadow-[inset_3px_0_0_0_hsl(var(--primary)),0_0_14px_-4px_hsl(var(--primary)/0.45)]',
        className
      )}
      variant="ghost"
      title={t(title)}
      ref={ref}
      {...props}
    >
      {children}
      <div className="max-xl:hidden min-w-0 flex-1 text-left break-words leading-snug pr-0.5">
        {t(description ?? title)}
      </div>
    </Button>
  )
})
SidebarItem.displayName = 'SidebarItem'
export default SidebarItem
