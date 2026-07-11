import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import { forwardRef, HTMLAttributes, ReactNode } from 'react'

export const SettingsPageContainer = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('space-y-6 px-3 pt-3 pb-6 sm:px-4 sm:pt-4', className)}
      {...props}
    />
  )
)
SettingsPageContainer.displayName = 'SettingsPageContainer'

export const SettingsGroup = ({
  title,
  description,
  children,
  className
}: {
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) => (
  <section className={cn('space-y-1.5', className)}>
    {title && (
      <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
    )}
    <div className="overflow-hidden rounded-xl border bg-card">{children}</div>
    {description && <p className="px-3 text-xs text-muted-foreground">{description}</p>}
  </section>
)

export const SettingsSection = ({
  title,
  description,
  children,
  className
}: {
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) => (
  <section className={cn('space-y-2', className)}>
    {title && (
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
    )}
    {children}
    {description && <p className="px-1 text-xs text-muted-foreground">{description}</p>}
  </section>
)

type SettingsRowProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  icon?: ReactNode
  title?: ReactNode
  description?: ReactNode
  htmlFor?: string
  control?: ReactNode
  chevron?: boolean
  trailing?: ReactNode
  layout?: 'inline' | 'stacked'
  destructive?: boolean
  disabled?: boolean
  clickable?: boolean
}

export const SettingsRow = forwardRef<HTMLDivElement, SettingsRowProps>(
  (
    {
      icon,
      title,
      description,
      htmlFor,
      control,
      onClick,
      chevron,
      trailing,
      layout = 'inline',
      children,
      className,
      destructive,
      disabled,
      clickable,
      ...rest
    },
    ref
  ) => {
    const isClickable = (clickable || !!onClick) && !disabled
    const isStacked = layout === 'stacked'

    const labelContent = (
      <div className={cn('min-w-0 flex-1', isStacked && 'flex flex-col gap-0.5')}>
        {title !== undefined && (
          <div
            className={cn(
              'text-base leading-snug',
              destructive && 'text-destructive',
              disabled && 'opacity-50'
            )}
          >
            {title}
          </div>
        )}
        {description && (
          <div className="text-sm leading-snug text-muted-foreground">{description}</div>
        )}
      </div>
    )

    const labelArea = htmlFor ? (
      <Label
        htmlFor={htmlFor}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center gap-3 font-normal',
          disabled && 'cursor-not-allowed'
        )}
      >
        {icon && (
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-5">
            {icon}
          </span>
        )}
        {labelContent}
      </Label>
    ) : (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon && (
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-5">
            {icon}
          </span>
        )}
        {labelContent}
      </div>
    )

    const trailingArea =
      !isStacked && (control || chevron || trailing) ? (
        <div className="flex shrink-0 items-center gap-2">
          {trailing && <span className="text-sm text-muted-foreground">{trailing}</span>}
          {control}
          {chevron && (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
          )}
        </div>
      ) : null

    return (
      <div
        ref={ref}
        onClick={isClickable ? onClick : undefined}
        role={isClickable ? 'button' : undefined}
        aria-disabled={disabled}
        className={cn(
          'group/row relative border-b border-border/60 last:border-b-0',
          'flex select-none items-center gap-3 px-4 py-3',
          isStacked && 'flex-col items-stretch',
          isClickable && 'clickable',
          className
        )}
        {...rest}
      >
        {!isStacked ? (
          <>
            {labelArea}
            {trailingArea}
          </>
        ) : (
          <>
            {(title !== undefined || description || icon || htmlFor) && (
              <div className="flex items-center gap-3">{labelArea}</div>
            )}
            {children && <div className="w-full">{children}</div>}
          </>
        )}
      </div>
    )
  }
)
SettingsRow.displayName = 'SettingsRow'
