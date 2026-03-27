import {
  POLL_OPTION_IMAGE_MAX_HEIGHT_PX,
  parsePollOptionVisualParts,
  type TPollOptionVisualParts
} from '@/lib/poll-option-display'
import { cn } from '@/lib/utils'

export default function PollOptionContent({
  label,
  visualParts: visualPartsProp,
  className,
  textClassName
}: {
  label: string
  /** When supplied (e.g. from parent), avoids parsing twice. */
  visualParts?: TPollOptionVisualParts
  className?: string
  textClassName?: string
}) {
  const { text, images } = visualPartsProp ?? parsePollOptionVisualParts(label)
  if (images.length === 0) {
    return (
      <div className={cn('line-clamp-2 text-left', textClassName, className)}>
        {label}
      </div>
    )
  }
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 text-left', className)}>
      {images.map(({ url, alt }, i) => (
        <img
          key={`${url}-${i}`}
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="max-w-full w-auto object-contain rounded-md"
          style={{ maxHeight: POLL_OPTION_IMAGE_MAX_HEIGHT_PX }}
        />
      ))}
      {text ? <div className={cn('line-clamp-2', textClassName)}>{text}</div> : null}
    </div>
  )
}
