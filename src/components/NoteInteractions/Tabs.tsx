import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useRef, useEffect, useState } from 'react'

export type TTabValue = 'replies' | 'quotes'
const TABS = [
  { value: 'replies', label: 'Replies' },
  { value: 'quotes', label: 'Quotes' }
] as { value: TTabValue; label: string }[]

export function Tabs({
  selectedTab,
  onTabChange,
  hideQuotesForDiscussion = false
}: {
  selectedTab: TTabValue
  onTabChange: (tab: TTabValue) => void
  /** Hide the quotes tab on discussion threads */
  hideQuotesForDiscussion?: boolean
}) {
  const { t } = useTranslation()
  const tabRefs = useRef<(HTMLDivElement | null)[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, left: 0, top: 0 })

  const visibleTabs = hideQuotesForDiscussion ? TABS.filter((tab) => tab.value !== 'quotes') : TABS

  useEffect(() => {
    setTimeout(() => {
      const activeIndex = visibleTabs.findIndex((tab) => tab.value === selectedTab)
      if (activeIndex >= 0 && tabRefs.current[activeIndex] && containerRef.current) {
        const activeTab = tabRefs.current[activeIndex]
        const container = containerRef.current
        const { offsetWidth, offsetLeft, offsetHeight } = activeTab
        
        // Get the container's top position relative to the viewport
        const containerTop = container.getBoundingClientRect().top
        const tabTop = activeTab.getBoundingClientRect().top
        
        // Calculate the indicator's top position relative to the container
        // Position it at the bottom of the active tab's row
        const relativeTop = tabTop - containerTop + offsetHeight
        // Responsive padding: smaller on mobile, larger on desktop
        const padding = window.innerWidth < 640 ? 16 : window.innerWidth < 768 ? 32 : 48
        
        setIndicatorStyle({
          width: offsetWidth - padding,
          left: offsetLeft + padding / 2,
          top: relativeTop - 4 // 4px for the indicator height (1px) + spacing
        })
      }
    }, 20) // ensure tabs are rendered before calculating
  }, [selectedTab, visibleTabs])

  return (
    <div className="w-full min-w-0">
      <div ref={containerRef} className="flex relative gap-1 overflow-x-auto scrollbar-hide">
        {visibleTabs.map((tab, index) => (
          <div
            key={tab.value}
            ref={(el) => (tabRefs.current[index] = el)}
            className={cn(
              `text-center py-2 px-2 sm:px-4 md:px-6 font-semibold whitespace-nowrap clickable cursor-pointer rounded-lg text-xs sm:text-sm md:text-base shrink-0`,
              selectedTab === tab.value ? '' : 'text-muted-foreground'
            )}
            onClick={() => onTabChange(tab.value)}
          >
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
  )
}
