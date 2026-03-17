import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Ellipsis } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useState, useMemo } from 'react'
import { DesktopMenu } from './DesktopMenu'
import { MobileMenu } from './MobileMenu'
import RawEventDialog from './RawEventDialog'
import ReportDialog from './ReportDialog'
import { SubMenuAction, useMenuActions } from './useMenuActions'
import PostEditor from '../PostEditor'
import type { HighlightData } from '../PostEditor/HighlightEditor'

export default function NoteOptions({
  event,
  className,
  initialHighlightData,
  highlightDefaultContent,
  isPostEditorOpen,
  onPostEditorClose,
  onOpenPublicMessage,
  initialPublicMessageTo,
  onOpenCallInvite,
  initialDefaultContent
}: {
  event: Event
  className?: string
  initialHighlightData?: HighlightData
  highlightDefaultContent?: string
  isPostEditorOpen?: boolean
  onPostEditorClose?: () => void
  /** Opens the post editor in public message mode with the given pubkey in the mention list. */
  onOpenPublicMessage?: (pubkey: string) => void
  /** When set, the post editor is opened in public message mode with this pubkey pre-filled. */
  initialPublicMessageTo?: string | null
  /** Opens the post editor with the given content (e.g. call invite URL). */
  onOpenCallInvite?: (url: string) => void
  /** Default content when opening the editor (e.g. call invite URL). */
  initialDefaultContent?: string | null
}) {
  const { isSmallScreen } = useScreenSize()
  const [isRawEventDialogOpen, setIsRawEventDialogOpen] = useState(false)
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [showSubMenu, setShowSubMenu] = useState(false)
  const [activeSubMenu, setActiveSubMenu] = useState<SubMenuAction[]>([])
  const [subMenuTitle, setSubMenuTitle] = useState('')

  const closeDrawer = () => {
    setIsDrawerOpen(false)
    setShowSubMenu(false)
  }

  const goBackToMainMenu = () => {
    setShowSubMenu(false)
  }

  const showSubMenuActions = (subMenu: SubMenuAction[], title: string) => {
    setActiveSubMenu(subMenu)
    setSubMenuTitle(title)
    setShowSubMenu(true)
  }

  const menuActions = useMenuActions({
    event,
    closeDrawer,
    showSubMenuActions,
    setIsRawEventDialogOpen,
    setIsReportDialogOpen,
    isSmallScreen,
    onOpenPublicMessage,
    onOpenCallInvite
  })

  const trigger = useMemo(
    () => (
      <button
        className="flex items-center text-muted-foreground hover:text-foreground pl-2 h-full"
        onClick={() => setIsDrawerOpen(true)}
      >
        <Ellipsis />
      </button>
    ),
    []
  )

  return (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      {isSmallScreen ? (
        <MobileMenu
          menuActions={menuActions}
          trigger={trigger}
          isDrawerOpen={isDrawerOpen}
          setIsDrawerOpen={setIsDrawerOpen}
          showSubMenu={showSubMenu}
          activeSubMenu={activeSubMenu}
          subMenuTitle={subMenuTitle}
          closeDrawer={closeDrawer}
          goBackToMainMenu={goBackToMainMenu}
        />
      ) : (
        <DesktopMenu menuActions={menuActions} trigger={trigger} />
      )}

      <RawEventDialog
        event={event}
        isOpen={isRawEventDialogOpen}
        onClose={() => setIsRawEventDialogOpen(false)}
      />
      <ReportDialog
        event={event}
        isOpen={isReportDialogOpen}
        closeDialog={() => setIsReportDialogOpen(false)}
      />
      {onPostEditorClose != null && (
        <PostEditor
          open={isPostEditorOpen ?? false}
          setOpen={(open) => {
            if (!open) onPostEditorClose()
          }}
          defaultContent={initialDefaultContent ?? highlightDefaultContent ?? ''}
          initialHighlightData={initialHighlightData}
          initialPublicMessageTo={initialPublicMessageTo ?? undefined}
        />
      )}
    </div>
  )
}
