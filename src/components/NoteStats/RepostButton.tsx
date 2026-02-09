import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerOverlay } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { createRepostDraftEvent } from '@/lib/draft-event'
import { getNoteBech32Id } from '@/lib/event'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import noteStatsService from '@/services/note-stats.service'
import { Loader, PencilLine, Repeat } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import logger from '@/lib/logger'
import PostEditor from '../PostEditor'
import { formatCount } from './utils'
import { showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'

export default function RepostButton({ event, hideCount = false }: { event: Event; hideCount?: boolean }) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { hideUntrustedInteractions, isUserTrusted } = useUserTrust()
  const { publish, checkLogin, pubkey } = useNostr()
  const noteStats = useNoteStatsById(event.id) as import('@/services/note-stats.service').TNoteStats | undefined
  const [reposting, setReposting] = useState(false)
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const { repostCount, hasReposted } = useMemo(() => {
    return {
      repostCount: hideUntrustedInteractions
        ? noteStats?.reposts?.filter((repost) => isUserTrusted(repost.pubkey)).length
        : noteStats?.reposts?.length,
      hasReposted: pubkey ? noteStats?.repostPubkeySet?.has(pubkey) : false
    }
  }, [noteStats, event.id, hideUntrustedInteractions])
  const canRepost = !hasReposted && !reposting

  const repost = async () => {
    checkLogin(async () => {
      if (!canRepost || !pubkey) return

      setReposting(true)
      const timer = setTimeout(() => setReposting(false), 5000)

      try {
        const hasReposted = noteStats?.repostPubkeySet?.has(pubkey)
        if (hasReposted) return
        if (!noteStats?.updatedAt) {
          await noteStatsService.fetchNoteStats(event, pubkey)
          // Note: fetchNoteStats doesn't return the stats, it updates them asynchronously
          // The updated stats will be available through the useNoteStatsById hook
        }

        const repost = createRepostDraftEvent(event)
        const evt = await publish(repost)
        
        // Show publishing feedback
        if ((evt as any)?.relayStatuses) {
          showPublishingFeedback({
            success: true,
            relayStatuses: (evt as any).relayStatuses,
            successCount: (evt as any).relayStatuses.filter((s: any) => s.success).length,
            totalCount: (evt as any).relayStatuses.length
          }, {
            message: t('Repost published'),
            duration: 4000
          })
        } else {
          showSimplePublishSuccess(t('Repost published'))
        }
        
        noteStatsService.updateNoteStatsByEvents([evt])
      } catch (error) {
        logger.error('Repost failed', { error, eventId: event.id })
      } finally {
        setReposting(false)
        clearTimeout(timer)
      }
    })
  }

  const trigger = (
    <button
      className={cn(
        'flex gap-1 items-center enabled:hover:text-lime-500 px-3 h-full',
        hasReposted ? 'text-lime-500' : 'text-muted-foreground'
      )}
      title={t('Repost')}
      onClick={() => {
        if (isSmallScreen) {
          setIsDrawerOpen(true)
        }
      }}
    >
      {reposting ? <Loader className="animate-spin" /> : <Repeat />}
      {!hideCount && !!repostCount && <div className="text-sm">{formatCount(repostCount)}</div>}
    </button>
  )

  const postEditor = (
    <PostEditor
      open={isPostDialogOpen}
      setOpen={setIsPostDialogOpen}
      defaultContent={'\nnostr:' + getNoteBech32Id(event)}
    />
  )

  if (isSmallScreen) {
    return (
      <>
        {trigger}
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerOverlay onClick={() => setIsDrawerOpen(false)} />
          <DrawerContent hideOverlay>
            <DrawerHeader className="sr-only">
              <DrawerTitle>Repost</DrawerTitle>
            </DrawerHeader>
            <div className="py-2">
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsDrawerOpen(false)
                  repost()
                }}
                disabled={!canRepost}
                className="w-full p-6 justify-start text-lg gap-4 [&_svg]:size-5"
                variant="ghost"
              >
                <Repeat /> {t('Repost')}
              </Button>
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsDrawerOpen(false)
                  checkLogin(() => {
                    setIsPostDialogOpen(true)
                  })
                }}
                className="w-full p-6 justify-start text-lg gap-4 [&_svg]:size-5"
                variant="ghost"
              >
                <PencilLine /> {t('Quote')}
              </Button>
            </div>
          </DrawerContent>
        </Drawer>
        {postEditor}
      </>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              repost()
            }}
            disabled={!canRepost}
          >
            <Repeat /> {t('Repost')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              checkLogin(() => {
                setIsPostDialogOpen(true)
              })
            }}
          >
            <PencilLine /> {t('Quote')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {postEditor}
    </>
  )
}
