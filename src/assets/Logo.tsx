import { publicAssetUrl } from '@/constants'
import { cn } from '@/lib/utils'
import type { MouseEvent } from 'react'

/** Wide brand strip for expanded sidebar (from `public/banner.png`). */
export default function Logo({ className }: { className?: string }) {
  return (
    <img
      src={publicAssetUrl('banner.png')}
      alt="Imwald"
      width={868}
      height={194}
      decoding="async"
      className={cn(
        'w-full max-w-full h-auto max-h-11 object-contain object-left',
        'brightness-[0.98] saturate-[1.03] dark:brightness-[1.08] dark:contrast-[1.02]',
        className
      )}
    />
  )
}

const brandBarShell =
  'flex justify-center border-b border-[hsl(var(--sidebar-border))] bg-gradient-to-b from-[hsl(var(--sidebar-top))] to-[hsl(var(--sidebar-bottom))] px-2 py-2 sm:px-3'

/** Full-width mobile/secondary chrome: same moss gradient as the sidebar + centered banner. */
export function ImwaldBrandBar({
  className,
  logoClassName,
  onClick
}: {
  className?: string
  logoClassName?: string
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
}) {
  const inner = (
    <div className={cn(brandBarShell, className)}>
      <Logo
        className={cn(
          'mx-auto h-auto w-full max-w-full max-h-14 object-contain object-center sm:max-h-16',
          logoClassName
        )}
      />
    </div>
  )
  if (onClick) {
    return (
      <button type="button" className="block w-full text-left" onClick={onClick} aria-label="Imwald">
        {inner}
      </button>
    )
  }
  return inner
}
