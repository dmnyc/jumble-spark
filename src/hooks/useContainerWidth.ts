import { RefObject, useEffect, useState } from 'react'

/**
 * Tracks the rendered width of `ref`'s element via ResizeObserver.
 * Returns `undefined` until the first measurement fires.
 * Use this when you need a component to respond to its *own* container width
 * rather than the viewport width (e.g. inside a split-pane layout where
 * `isSmallScreen` is still `false` but the column is narrow).
 */
export function useContainerWidth(ref: RefObject<Element | null>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    // Initialise synchronously so there's no render flash
    setWidth(el.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [ref])

  return width
}
