import { cn, isTouchDevice } from '@/lib/utils'
import { RefreshCcw } from 'lucide-react'
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'

const PULL_THRESHOLD = 70
const HOLD_OFFSET = 52
const MAX_OFFSET = 140
const DAMPING = 0.5
const SNAP_DURATION = 240
const REFRESH_MIN_VISIBLE = 280
const COMMIT_DY = 6

type TPullState = 'idle' | 'pulling' | 'refreshing' | 'snapping'

export default function PullToRefresh({
  onRefresh,
  isPullable = true,
  children
}: {
  onRefresh: () => void | Promise<void>
  isPullable?: boolean
  children: ReactNode
}) {
  const supportTouch = useMemo(() => isTouchDevice(), [])
  const containerRef = useRef<HTMLDivElement>(null)

  const [offset, setOffsetState] = useState(0)
  const [state, setStateValue] = useState<TPullState>('idle')

  const offsetRef = useRef(0)
  const stateRef = useRef<TPullState>('idle')
  const startYRef = useRef<number | null>(null)
  const startXRef = useRef<number | null>(null)
  const committedRef = useRef(false)
  const isPullableRef = useRef(isPullable)
  const onRefreshRef = useRef(onRefresh)

  useEffect(() => {
    isPullableRef.current = isPullable
  }, [isPullable])

  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  const setOffset = (v: number) => {
    offsetRef.current = v
    setOffsetState(v)
  }
  const setState = (v: TPullState) => {
    stateRef.current = v
    setStateValue(v)
  }

  useEffect(() => {
    if (!supportTouch) return
    const node = containerRef.current
    if (!node) return

    const reset = () => {
      startYRef.current = null
      startXRef.current = null
      committedRef.current = false
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (!isPullableRef.current) return
      if (stateRef.current === 'refreshing' || stateRef.current === 'snapping') return
      if (window.scrollY > 0) return
      const t = e.touches[0]
      startYRef.current = t.clientY
      startXRef.current = t.clientX
      committedRef.current = false
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || startXRef.current === null) return
      if (!isPullableRef.current) {
        reset()
        if (stateRef.current === 'pulling') {
          setState('snapping')
          setOffset(0)
          window.setTimeout(() => {
            if (stateRef.current === 'snapping') setState('idle')
          }, SNAP_DURATION)
        }
        return
      }
      const t = e.touches[0]
      const dy = t.clientY - startYRef.current
      const dx = t.clientX - startXRef.current

      if (!committedRef.current) {
        if (dy <= COMMIT_DY) {
          if (dy < -COMMIT_DY || Math.abs(dx) > Math.abs(dy)) {
            reset()
          }
          return
        }
        if (Math.abs(dx) > Math.abs(dy)) {
          reset()
          return
        }
        committedRef.current = true
        setState('pulling')
      }

      if (e.cancelable) e.preventDefault()
      const damped = Math.min(dy * DAMPING, MAX_OFFSET)
      setOffset(Math.max(0, damped))
    }

    const handleTouchEnd = () => {
      const wasCommitted = committedRef.current
      reset()
      if (!wasCommitted || stateRef.current !== 'pulling') {
        if (stateRef.current === 'pulling') {
          setState('snapping')
          setOffset(0)
          window.setTimeout(() => {
            if (stateRef.current === 'snapping') setState('idle')
          }, SNAP_DURATION)
        }
        return
      }

      if (offsetRef.current >= PULL_THRESHOLD) {
        setState('refreshing')
        setOffset(HOLD_OFFSET)
        const start = Date.now()
        Promise.resolve()
          .then(() => onRefreshRef.current())
          .catch((err) => console.error('PullToRefresh onRefresh error:', err))
          .finally(() => {
            const elapsed = Date.now() - start
            const wait = Math.max(0, REFRESH_MIN_VISIBLE - elapsed)
            window.setTimeout(() => {
              setState('snapping')
              setOffset(0)
              window.setTimeout(() => {
                if (stateRef.current === 'snapping') setState('idle')
              }, SNAP_DURATION)
            }, wait)
          })
      } else {
        setState('snapping')
        setOffset(0)
        window.setTimeout(() => {
          if (stateRef.current === 'snapping') setState('idle')
        }, SNAP_DURATION)
      }
    }

    node.addEventListener('touchstart', handleTouchStart, { passive: true })
    node.addEventListener('touchmove', handleTouchMove, { passive: false })
    node.addEventListener('touchend', handleTouchEnd, { passive: true })
    node.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    return () => {
      node.removeEventListener('touchstart', handleTouchStart)
      node.removeEventListener('touchmove', handleTouchMove)
      node.removeEventListener('touchend', handleTouchEnd)
      node.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [supportTouch])

  if (!supportTouch) {
    return <>{children}</>
  }

  const progress = Math.min(offset / PULL_THRESHOLD, 1)
  const reached = progress >= 1
  const isAnimating = state === 'snapping' || state === 'refreshing'
  const transition = isAnimating ? `transform ${SNAP_DURATION}ms cubic-bezier(.2,.8,.2,1)` : 'none'
  const indicatorOpacity = state === 'idle' ? 0 : Math.min(offset / 28, 1)
  const indicatorRotation = state === 'refreshing' ? 0 : progress * 270

  const indicatorTranslate = offset / 2 - 16

  return (
    <div ref={containerRef} className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-s-0 inset-e-0 top-0 z-10 flex justify-center"
        style={{
          transform: `translate3d(0, ${indicatorTranslate}px, 0)`,
          opacity: indicatorOpacity,
          transition: isAnimating
            ? `transform ${SNAP_DURATION}ms cubic-bezier(.2,.8,.2,1), opacity ${SNAP_DURATION}ms ease-out`
            : 'opacity 120ms ease-out'
        }}
      >
        <div
          className={cn(
            'bg-background flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-colors',
            reached || state === 'refreshing' ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          <RefreshCcw
            className={cn('size-4', state === 'refreshing' && 'animate-spin')}
            style={
              state === 'refreshing'
                ? undefined
                : {
                    transform: `rotate(${indicatorRotation}deg)`,
                    transition: isAnimating
                      ? `transform ${SNAP_DURATION}ms cubic-bezier(.2,.8,.2,1)`
                      : 'none'
                  }
            }
          />
        </div>
      </div>
      <div
        style={{
          transform: `translate3d(0, ${offset}px, 0)`,
          transition,
          willChange: state === 'pulling' || isAnimating ? 'transform' : undefined
        }}
      >
        {children}
      </div>
    </div>
  )
}
