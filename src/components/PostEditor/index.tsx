import StoredAccountSwitchSelect from '@/components/StoredAccountSwitchSelect'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { pubkeyToNpub } from '@/lib/pubkey'
import postEditor from '@/services/post-editor.service'
import { Event } from 'nostr-tools'
import { Dispatch, useMemo } from 'react'
import type { TDiscussionDynamicTopics } from '@/lib/discussion-thread-composer'
import PostContent from './PostContent'

export default function PostEditor({
  defaultContent = '',
  parentEvent,
  open,
  setOpen,
  openFrom,
  initialHighlightData,
  initialPublicMessageTo,
  onPublishSuccess,
  discussionDynamicTopics
}: {
  defaultContent?: string
  parentEvent?: Event
  open: boolean
  setOpen: Dispatch<boolean>
  openFrom?: string[]
  initialHighlightData?: import('./HighlightEditor').HighlightData
  /** When set, opens in public message mode with this pubkey in the mention list. */
  initialPublicMessageTo?: string
  /** Called after a reply/post is successfully published, before closing. */
  onPublishSuccess?: () => void
  /** Hot topics for the discussion (kind 11) composer when integrated in this editor. */
  discussionDynamicTopics?: TDiscussionDynamicTopics | null
}) {
  const { isSmallScreen } = useScreenSize()

  const effectiveDefaultContent = useMemo(() => {
    if (initialPublicMessageTo) {
      const npub = pubkeyToNpub(initialPublicMessageTo)
      const suffix = defaultContent ? ` ${defaultContent}` : ' '
      return npub ? `nostr:${npub}${suffix}`.trimEnd() : defaultContent
    }
    return defaultContent
  }, [initialPublicMessageTo, defaultContent])

  const content = useMemo(() => {
    return (
      <PostContent
        defaultContent={effectiveDefaultContent}
        parentEvent={parentEvent}
        close={() => setOpen(false)}
        openFrom={openFrom}
        initialHighlightData={initialHighlightData}
        initialPublicMessageTo={initialPublicMessageTo}
        onPublishSuccess={onPublishSuccess}
        discussionDynamicTopics={discussionDynamicTopics}
      />
    )
  }, [
    effectiveDefaultContent,
    parentEvent,
    openFrom,
    setOpen,
    initialHighlightData,
    initialPublicMessageTo,
    onPublishSuccess,
    discussionDynamicTopics
  ])

  if (isSmallScreen) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className="h-full w-full max-w-full p-0 border-none overflow-hidden"
          side="bottom"
          hideClose
          onEscapeKeyDown={(e) => {
            if (postEditor.isSuggestionPopupOpen) {
              e.preventDefault()
              postEditor.closeSuggestionPopup()
            }
          }}
        >
          <ScrollArea className="px-4 h-full max-h-screen min-w-0 overflow-x-auto" scrollBarClassName="opacity-100">
            <div className="space-y-4 px-2 pr-4 py-6 min-w-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Post Editor</SheetTitle>
                <SheetDescription>Create a new post or reply</SheetDescription>
              </SheetHeader>
              {open ? (
                <StoredAccountSwitchSelect
                  withBottomBorder
                  className="w-full flex-wrap"
                  showLabelAlways
                />
              ) : null}
              {content}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="p-0 max-w-2xl w-[calc(100vw-2rem)] sm:w-full overflow-hidden"
        withoutClose
        onEscapeKeyDown={(e) => {
          if (postEditor.isSuggestionPopupOpen) {
            e.preventDefault()
            postEditor.closeSuggestionPopup()
          }
        }}
      >
        <ScrollArea className="px-4 h-full max-h-screen min-w-0" scrollBarClassName="opacity-100">
          <div className="space-y-4 px-2 pr-4 py-6 min-w-0">
            <DialogHeader className="sr-only">
              <DialogTitle>Post Editor</DialogTitle>
              <DialogDescription>Create a new post or reply</DialogDescription>
            </DialogHeader>
            {open ? (
              <StoredAccountSwitchSelect
                withBottomBorder
                className="w-full flex-wrap"
                showLabelAlways
              />
            ) : null}
            {content}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
