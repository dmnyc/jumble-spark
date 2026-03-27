import { useCallback, useRef } from 'react'

const DEFAULT_MS = 650

/**
 * Pointer long-press: fires `onLongPress` after `ms`. Use `consumeIfLongPress()` in `onClick` to ignore the click that follows a long-press.
 */
export function useLongPressAction(
  onLongPress: () => void,
  options?: { ms?: number; enabled?: boolean }
) {
  const ms = options?.ms ?? DEFAULT_MS
  const enabled = options?.enabled ?? true
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const onPointerDown = useCallback(() => {
    if (!enabled) return
    firedRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      firedRef.current = true
      onLongPress()
    }, ms)
  }, [clearTimer, enabled, ms, onLongPress])

  const onPointerEnd = useCallback(() => {
    clearTimer()
  }, [clearTimer])

  const consumeIfLongPress = useCallback(() => {
    if (firedRef.current) {
      firedRef.current = false
      return true
    }
    return false
  }, [])

  return {
    onPointerDown,
    onPointerUp: onPointerEnd,
    onPointerLeave: onPointerEnd,
    onPointerCancel: onPointerEnd,
    consumeIfLongPress
  }
}
