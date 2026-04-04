import { ImwaldBrandBar } from '@/assets/Logo'
import ScrollToTopButton from '@/components/ScrollToTopButton'
import { ReadOnlySessionIndicator } from '@/components/ReadOnlySessionIndicator'
import { Titlebar } from '@/components/Titlebar'
import { Button } from '@/components/ui/button'
import {
  FOCUS_SECONDARY_SCROLL_SHORTCUT_KEY,
  isRadixDialogOpen,
  shouldIgnoreKeyboardShortcutEvent
} from '@/lib/keyboard-shortcuts'
import { useSecondaryPage } from '@/PageManager'
import { DeepBrowsingProvider } from '@/providers/DeepBrowsingProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ChevronLeft } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const SecondaryPageLayout = forwardRef(
  (
    {
      children,
      index,
      title,
      controls,
      hideBackButton = false,
      hideTitlebarBottomBorder = false,
      displayScrollToTopButton = false,
      titlebar
    }: {
      children?: React.ReactNode
      index?: number
      title?: React.ReactNode
      controls?: React.ReactNode
      hideBackButton?: boolean
      hideTitlebarBottomBorder?: boolean
      displayScrollToTopButton?: boolean
      titlebar?: React.ReactNode
    },
    ref
  ) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const { isSmallScreen } = useScreenSize()
    const { currentIndex } = useSecondaryPage()

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
      if (isSmallScreen) {
        setTimeout(() => window.scrollTo({ top: 0 }), 10)
        return
      }
    }, [])

    useEffect(() => {
      if (isSmallScreen) return
      if (currentIndex !== index) return

      const onKeyDown = (e: KeyboardEvent) => {
        if (!e.altKey || !e.shiftKey || e.key.toLowerCase() !== FOCUS_SECONDARY_SCROLL_SHORTCUT_KEY) return
        if (e.metaKey || e.ctrlKey) return
        if (shouldIgnoreKeyboardShortcutEvent(e.target)) return
        if (isRadixDialogOpen()) return

        e.preventDefault()
        scrollAreaRef.current?.focus({ preventScroll: true })
      }

      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }, [isSmallScreen, currentIndex, index])

    if (isSmallScreen) {
      return (
        <DeepBrowsingProvider active={currentIndex === index}>
          <div
            style={{
              paddingBottom: 'calc(env(safe-area-inset-bottom) + 3rem)'
            }}
          >
            {title && (
              <>
                <div className="flex justify-center py-1 border-b">
                  <span className="text-green-600 dark:text-green-500 font-semibold text-sm">
                    Imwald
                  </span>
                </div>
                <SecondaryPageTitlebar
                  title={title}
                  controls={controls}
                  hideBackButton={hideBackButton}
                  hideBottomBorder={hideTitlebarBottomBorder}
                  titlebar={titlebar}
                />
              </>
            )}
            {children}
          </div>
          {displayScrollToTopButton && <ScrollToTopButton />}
        </DeepBrowsingProvider>
      )
    }

    return (
      <DeepBrowsingProvider active={currentIndex === index} scrollAreaRef={scrollAreaRef}>
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          {title && (
            <>
              <ImwaldBrandBar />
              <SecondaryPageTitlebar
                title={title}
                controls={controls}
                hideBackButton={hideBackButton}
                hideBottomBorder={hideTitlebarBottomBorder}
                titlebar={titlebar}
              />
            </>
          )}
          <div
            ref={scrollAreaRef}
            tabIndex={-1}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto"
          >
            {children}
            <div className="h-12" />
          </div>
        </div>
        {displayScrollToTopButton && <ScrollToTopButton scrollAreaRef={scrollAreaRef} />}
      </DeepBrowsingProvider>
    )
  }
)
SecondaryPageLayout.displayName = 'SecondaryPageLayout'
export default SecondaryPageLayout

export function SecondaryPageTitlebar({
  title,
  controls,
  hideBackButton = false,
  hideBottomBorder = false,
  titlebar
}: {
  title?: React.ReactNode
  controls?: React.ReactNode
  hideBackButton?: boolean
  hideBottomBorder?: boolean
  titlebar?: React.ReactNode
}): JSX.Element {
  if (titlebar) {
    return (
      <Titlebar
        className="flex min-w-0 items-center gap-2 p-1"
        hideBottomBorder={hideBottomBorder}
      >
        <ReadOnlySessionIndicator variant="titlebar" />
        <div className="min-h-0 min-w-0 flex-1 h-full">{titlebar}</div>
      </Titlebar>
    )
  }
  return (
    <Titlebar
      className="flex min-w-0 gap-1 p-1 items-center font-semibold"
      hideBottomBorder={hideBottomBorder}
    >
      <ReadOnlySessionIndicator variant="titlebar" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-1">
        {hideBackButton ? (
          <div className="flex gap-2 items-center pl-2 w-fit truncate font-display text-lg font-semibold">
            {title}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center">
            <BackButton>{title}</BackButton>
          </div>
        )}
        <div className="flex-shrink-0">{controls}</div>
      </div>
    </Titlebar>
  )
}

function BackButton({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation()
  const { pop } = useSecondaryPage()

  return (
    <Button
      className="flex gap-1 items-center w-fit max-w-full justify-start pl-2 pr-3"
      variant="ghost"
      size="titlebar-icon"
      title={t('back')}
      onClick={() => pop()}
    >
      <ChevronLeft />
              <div className="truncate font-display text-lg font-semibold">{children}</div>
    </Button>
  )
}
