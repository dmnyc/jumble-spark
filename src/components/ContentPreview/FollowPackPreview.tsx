import { resolveHttpMediaUrl } from '@/lib/badge-definition-media'
import { getImetaInfosFromEvent } from '@/lib/event'
import { getPubkeysFromPTags } from '@/lib/tag'
import logger from '@/lib/logger'
import { cn } from '@/lib/utils'
import { useFollowListOptional } from '@/providers/FollowListProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { useNostr } from '@/providers/NostrProvider'
import { Event } from 'nostr-tools'
import { Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import UserAvatar, { SimpleUserAvatar } from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Button } from '@/components/ui/button'

/** NIP-style `image` tags on kind 39089; falls back to first NIP-94 `imeta` URL. */
function followPackBannerUrlFromEvent(event: Event): string | undefined {
  for (const t of event.tags) {
    if (t[0] === 'image' && t[1]) {
      const u = resolveHttpMediaUrl(t[1])
      if (u) return u
    }
  }
  for (const im of getImetaInfosFromEvent(event)) {
    const u = resolveHttpMediaUrl(im.url)
    if (u) return u
  }
  return undefined
}

export default function FollowPackPreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const followList = useFollowListOptional()
  const followings = followList?.followings ?? []
  const { mutePubkeySet } = useMuteList()
  const [busy, setBusy] = useState(false)
  const [bannerFailed, setBannerFailed] = useState(false)

  const packPubkeys = useMemo(() => getPubkeysFromPTags(event.tags), [event.tags])
  const bannerUrl = useMemo(() => followPackBannerUrlFromEvent(event), [event])

  useEffect(() => {
    setBannerFailed(false)
  }, [event.id])

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
    () => packPubkeys.filter((p) => !muteSetHas(mutePubkeySet, p)),
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
      if (!followList) return
      const { follow } = followList
      const toFollow = packPubkeys.filter((p) => !followingSet.has(p) && !muteSetHas(mutePubkeySet, p))
      if (toFollow.length === 0) {
        const mutedCount = packPubkeys.filter((p) => muteSetHas(mutePubkeySet, p) && !followingSet.has(p)).length
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
    [pubkey, followList, packPubkeys, followingSet, mutePubkeySet, t]
  )

  return (
    <div className={cn('overflow-hidden rounded-lg border bg-muted/30', className)}>
      {bannerUrl && !bannerFailed ? (
        <div className="relative w-full max-h-52 overflow-hidden bg-muted">
          <img
            src={bannerUrl}
            alt={title}
            className="h-auto w-full max-h-52 object-cover object-center"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setBannerFailed(true)}
          />
        </div>
      ) : null}
      <div className="p-3">
      <div className="mb-2 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-muted-foreground">[{t('Follow Pack')}]</span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">{t('Follow pack by')}:</span>
          <UserAvatar userId={event.pubkey} size="xSmall" className="shrink-0" />
          <Username
            userId={event.pubkey}
            className="min-w-0 truncate font-medium text-foreground"
            skeletonClassName="h-3"
          />
        </div>
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
      ) : !followList ? null : (
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
    </div>
  )
}
