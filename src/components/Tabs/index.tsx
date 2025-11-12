import { cn } from '@/lib/utils'
import { useDeepBrowsing } from '@/providers/DeepBrowsingProvider'
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type TabDefinition = {
  value: string
  label: string
  icon?: ReactNode
}

export default function Tabs({
  tabs,
  value,
  onTabChange,
  threshold = 800,
  options = null
}: {
  tabs: TabDefinition[]
  value: string
  onTabChange?: (tab: string) => void
  threshold?: number
  options?: ReactNode
}) {
  const { t } = useTranslation()
  const { deepBrowsing, lastScrollTop } = useDeepBrowsing()
  const tabRefs = useRef<(HTMLDivElement | null)[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tabsContainerRef = useRef<HTMLDivElement | null>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, left: 0, top: 0 })
  const isUpdatingRef = useRef(false)
  const lastStyleRef = useRef({ width: 0, left: 0, top: 0 })

  const updateIndicatorPosition = useCallback(() => {
    // Prevent multiple simultaneous updates
    if (isUpdatingRef.current) return
    
    const activeIndex = tabs.findIndex((tab) => tab.value === value)
    if (activeIndex >= 0 && tabRefs.current[activeIndex] && tabsContainerRef.current) {
      const activeTab = tabRefs.current[activeIndex]
      const tabsContainer = tabsContainerRef.current
      const { offsetWidth, offsetLeft, offsetHeight } = activeTab
      const padding = 24 // 12px padding on each side
      
      // Get the container's top position relative to the viewport
      const containerTop = tabsContainer.getBoundingClientRect().top
      const tabTop = activeTab.getBoundingClientRect().top
      
      // Calculate the indicator's top position relative to the container
      // Position it at the bottom of the active tab's row
      const relativeTop = tabTop - containerTop + offsetHeight
      const newWidth = offsetWidth - padding
      const newLeft = offsetLeft + padding / 2
      const newTop = relativeTop - 4 // 4px for the indicator height (1px) + spacing
      
      // Only update if values actually changed
      if (
        lastStyleRef.current.width !== newWidth ||
        lastStyleRef.current.left !== newLeft ||
        lastStyleRef.current.top !== newTop
      ) {
        isUpdatingRef.current = true
        lastStyleRef.current = { width: newWidth, left: newLeft, top: newTop }
        
        setIndicatorStyle({ width: newWidth, left: newLeft, top: newTop })
        
        // Reset flag after state update completes
        requestAnimationFrame(() => {
          isUpdatingRef.current = false
        })
      }
    }
  }, [tabs, value])

  useEffect(() => {
    const animationId = requestAnimationFrame(() => {
      updateIndicatorPosition()
    })

    return () => {
      cancelAnimationFrame(animationId)
    }
  }, [updateIndicatorPosition])

  useEffect(() => {
    if (!containerRef.current || !tabsContainerRef.current) return

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        updateIndicatorPosition()
      })
    })

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            requestAnimationFrame(() => {
              updateIndicatorPosition()
            })
          }
        })
      },
      { threshold: 0 }
    )

    intersectionObserver.observe(containerRef.current)

    tabRefs.current.forEach((tab) => {
      if (tab) resizeObserver.observe(tab)
    })
    
    if (tabsContainerRef.current) {
      resizeObserver.observe(tabsContainerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
    }
  }, [updateIndicatorPosition])

  return (
    <div
      ref={containerRef}
      className={cn(
        'sticky flex justify-between top-12 bg-background z-30 px-1 w-full transition-transform border-b',
        deepBrowsing && lastScrollTop > threshold ? '-translate-y-[calc(100%+12rem)]' : ''
      )}
    >
      <div className="flex-1 w-0 min-w-0">
        <div ref={tabsContainerRef} className="flex relative gap-1 overflow-x-auto scrollbar-hide">
          {tabs.map((tab, index) => (
            <div
              key={tab.value}
              ref={(el) => (tabRefs.current[index] = el)}
              className={cn(
                `text-center py-2 px-2 sm:px-4 md:px-6 font-semibold whitespace-nowrap clickable cursor-pointer rounded-lg text-xs sm:text-sm md:text-base shrink-0 flex items-center gap-2 justify-center`,
                value === tab.value ? '' : 'text-muted-foreground'
              )}
              onClick={() => {
                onTabChange?.(tab.value)
              }}
            >
              {tab.icon && <span className="shrink-0">{tab.icon}</span>}
              {t(tab.label)}
            </div>
          ))}
          <div
            className="absolute h-1 bg-primary rounded-full transition-all duration-500"
            style={{
              width: `${indicatorStyle.width}px`,
              left: `${indicatorStyle.left}px`,
              top: `${indicatorStyle.top}px`
            }}
          />
        </div>
      </div>
      {options && <div className="py-1 flex items-center shrink-0 gap-1">{options}</div>}
    </div>
  )
}
