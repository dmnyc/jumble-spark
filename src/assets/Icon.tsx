import { cn } from '@/lib/utils'

/** Compact mark for narrow sidebar (from `public/favicon.png`). */
export default function Icon({ className }: { className?: string }) {
  return (
    <img
      src="/favicon.png"
      alt=""
      width={216}
      height={215}
      decoding="async"
      className={cn('mx-auto size-10 object-contain shrink-0', className)}
      role="presentation"
    />
  )
}
