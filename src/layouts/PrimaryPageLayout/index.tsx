import ScrollToTopButton from '@/components/ScrollToTopButton'
import { Titlebar } from '@/components/Titlebar'
import { TPrimaryPageName, usePrimaryPage } from '@/PageManager'
import { DeepBrowsingProvider } from '@/providers/DeepBrowsingProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const PrimaryPageLayout = forwardRef(
  (
    {
      children,
      titlebar,
      pageName,
      displayScrollToTopButton = false,
      hideTitlebarBottomBorder = false,
      subHeader
    }: {
      children?: React.ReactNode
      titlebar: React.ReactNode
      pageName: TPrimaryPageName
      displayScrollToTopButton?: boolean
      hideTitlebarBottomBorder?: boolean
      /** Rendered between titlebar and scroll area; not in scroll flow so it never overlaps content */
      subHeader?: React.ReactNode
    },
    ref
  ) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const smallScreenScrollAreaRef = useRef<HTMLDivElement>(null)
    const smallScreenLastScrollTopRef = useRef(0)
    const { isSmallScreen } = useScreenSize()
    const { current, display } = usePrimaryPage()

    useImperativeHandle(
      ref,
      () => ({
        scrollToTop: (behavior: ScrollBehavior = 'smooth') => {
          setTimeout(() => {
            if (scrollAreaRef.current) {
              return scrollAreaRef.current.scrollTo({ top: 0, behavior })
            }
            window.scrollTo({ top: 0, behavior })
          }, 10)
        }
      }),
      []
    )

    useEffect(() => {
      if (!isSmallScreen) return

      const isVisible = () => {
        return smallScreenScrollAreaRef.current?.checkVisibility
          ? smallScreenScrollAreaRef.current?.checkVisibility()
          : false
      }

      if (isVisible()) {
        window.scrollTo({ top: smallScreenLastScrollTopRef.current, behavior: 'instant' })
      }
      const handleScroll = () => {
        if (isVisible()) {
          smallScreenLastScrollTopRef.current = window.scrollY
        }
      }
      window.addEventListener('scroll', handleScroll)
      return () => {
        window.removeEventListener('scroll', handleScroll)
      }
    }, [current, isSmallScreen, display])

    if (isSmallScreen) {
      return (
        <DeepBrowsingProvider active={current === pageName && display}>
          <div
            ref={smallScreenScrollAreaRef}
            className="min-w-0 w-full overflow-x-hidden"
            style={{
              paddingBottom: 'calc(env(safe-area-inset-bottom) + 3rem)'
            }}
          >
            <PrimaryPageTitlebar hideBottomBorder={hideTitlebarBottomBorder}>
              {titlebar}
            </PrimaryPageTitlebar>
            {subHeader && <div className="shrink-0 w-full min-w-0 bg-background">{subHeader}</div>}
            <div className="min-w-0 w-full">
              {children}
            </div>
          </div>
          {displayScrollToTopButton && <ScrollToTopButton />}
        </DeepBrowsingProvider>
      )
    }

    return (
      <DeepBrowsingProvider active={current === pageName && display} scrollAreaRef={scrollAreaRef}>
        <div className="relative h-full min-h-0 flex flex-col">
          <PrimaryPageTitlebar hideBottomBorder={hideTitlebarBottomBorder}>
            {titlebar}
          </PrimaryPageTitlebar>
          {subHeader && <div className="shrink-0 bg-background">{subHeader}</div>}
          <div
            ref={scrollAreaRef}
            className={subHeader ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden' : 'absolute top-12 left-0 right-0 bottom-0 overflow-y-auto overflow-x-hidden'}
          >
            {children}
            <div className="h-4" />
          </div>
        </div>
        {displayScrollToTopButton && <ScrollToTopButton scrollAreaRef={scrollAreaRef} />}
      </DeepBrowsingProvider>
    )
  }
)
PrimaryPageLayout.displayName = 'PrimaryPageLayout'
export default PrimaryPageLayout

export type TPrimaryPageLayoutRef = {
  scrollToTop: (behavior?: ScrollBehavior) => void
}

function PrimaryPageTitlebar({
  children,
  hideBottomBorder = false
}: {
  children?: React.ReactNode
  hideBottomBorder?: boolean
}) {
  return (
    <Titlebar className="p-1" hideBottomBorder={hideBottomBorder}>
      {children}
    </Titlebar>
  )
}
