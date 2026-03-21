import { getPubkeysFromPTags } from '@/lib/tag'
import logger from '@/lib/logger'
import { cn } from '@/lib/utils'
import { useFollowList } from '@/providers/FollowListProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { Event } from 'nostr-tools'
import { Users } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SimpleUserAvatar } from '../UserAvatar'
import { Button } from '../ui/button'

export default function FollowPackPreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { followings, follow } = useFollowList()
  const { mutePubkeySet } = useMuteList()
  const [busy, setBusy] = useState(false)

  const packPubkeys = useMemo(() => getPubkeysFromPTags(event.tags), [event.tags])

  const getPackTitle = (pack: Event): string => {
    const titleTag = pack.tags.find((tag) => tag[0] === 'title' || tag[0] === 'name')
    return titleTag?.[1] || t('Follow Pack')
  }

  const getPackDescription = (pack: Event): string => {
    const descTag = pack.tags.find((tag) => tag[0] === 'description' || tag[0] === 'd')
    return descTag?.[1] || ''
  }

  const title = getPackTitle(event)
  const description = getPackDescription(event)

  const followingSet = useMemo(() => new Set(followings), [followings])
  const availablePubkeys = useMemo(
    () => packPubkeys.filter((p) => !mutePubkeySet.has(p)),
    [packPubkeys, mutePubkeySet]
  )
  const alreadyFollowingAll =
    availablePubkeys.length > 0 && availablePubkeys.every((p) => followingSet.has(p))
  const toFollowCount = availablePubkeys.filter((p) => !followingSet.has(p)).length

  const handleFollowPack = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!pubkey) {
        toast.error(t('Please log in to follow'))
        return
      }
      const toFollow = packPubkeys.filter((p) => !followingSet.has(p) && !mutePubkeySet.has(p))
      if (toFollow.length === 0) {
        const mutedCount = packPubkeys.filter((p) => mutePubkeySet.has(p) && !followingSet.has(p)).length
        if (mutedCount > 0) {
          toast.info(t('All available members are already followed or muted'))
        } else {
          toast.info(t('You are already following all members of this pack'))
        }
        return
      }
      setBusy(true)
      try {
        for (const pubkeyToFollow of toFollow) {
          await follow(pubkeyToFollow)
        }
        toast.success(t('Followed {{count}} users', { count: toFollow.length }))
      } catch (error) {
        logger.error('Failed to follow pack', { error })
        toast.error(t('Failed to follow pack') + ': ' + (error as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [pubkey, packPubkeys, followingSet, mutePubkeySet, follow, t]
  )

  return (
    <div className={cn('rounded-lg border bg-muted/30 p-3', className)}>
      <div className="mb-2 flex items-center gap-1">
        <span className="text-sm text-muted-foreground">[{t('Follow Pack')}]</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>

      {description ? (
        <div className="mb-3 line-clamp-2 text-sm text-muted-foreground">{description}</div>
      ) : null}

      <div className="mb-3 flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4" />
          <span>{t('{{count}} profiles', { count: availablePubkeys.length })}</span>
        </div>

        {availablePubkeys.length > 0 ? (
          <div className="flex -space-x-2">
            {availablePubkeys.slice(0, 5).map((pk) => (
              <SimpleUserAvatar
                key={pk}
                userId={pk}
                size="small"
                className="border-2 border-background"
              />
            ))}
            {availablePubkeys.length > 5 ? (
              <div className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-xs text-muted-foreground">
                +{availablePubkeys.length - 5}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {!pubkey ? (
        <p className="text-sm text-muted-foreground">{t('Please log in to follow')}</p>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={alreadyFollowingAll || busy}
          onClick={handleFollowPack}
        >
          {alreadyFollowingAll ? (
            t('Following All')
          ) : (
            <>
              {t('Follow')}
              {toFollowCount > 0 ? ` (${toFollowCount})` : ''}
            </>
          )}
        </Button>
      )}
    </div>
  )
}
