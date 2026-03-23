import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useFollowList } from '@/providers/FollowListProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function FollowButton({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { pubkey: accountPubkey, checkLogin } = useNostr()
  const { followings, follow, unfollow } = useFollowList()
  const { mutePubkeySet, unmutePubkey } = useMuteList()
  const [updating, setUpdating] = useState(false)
  const [hover, setHover] = useState(false)
  const isFollowing = useMemo(() => followings.includes(pubkey), [followings, pubkey])
  const isMuted = useMemo(() => mutePubkeySet.has(pubkey), [mutePubkeySet, pubkey])

  if (!accountPubkey || (pubkey && pubkey === accountPubkey)) return null

  const handleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      if (isFollowing) return

      setUpdating(true)
      try {
        await follow(pubkey)
      } catch (error) {
        toast.error(t('Follow failed') + ': ' + (error as Error).message)
      } finally {
        setUpdating(false)
      }
    })
  }

  const handleUnfollow = async (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      if (!isFollowing) return

      setUpdating(true)
      try {
        await unfollow(pubkey)
      } catch (error) {
        toast.error(t('Unfollow failed') + ': ' + (error as Error).message)
      } finally {
        setUpdating(false)
      }
    })
  }

  const handleUnmute = async (e: React.MouseEvent) => {
    e.stopPropagation()
    checkLogin(async () => {
      if (!isMuted) return

      setUpdating(true)
      try {
        await unmutePubkey(pubkey)
        toast.success(t('User unmuted'))
      } catch (error) {
        toast.error(t('Unmute failed') + ': ' + (error as Error).message)
      } finally {
        setUpdating(false)
      }
    })
  }

  // If following and muted, show "Muted" button instead of "Following"
  if (isFollowing && isMuted) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            className="rounded-full min-w-28 max-w-full text-destructive whitespace-normal break-words px-3"
            variant="secondary"
            disabled={updating}
          >
            {updating ? (
              <Skeleton className="mx-auto size-4 shrink-0 rounded-full" aria-hidden />
            ) : (
              <span className="text-destructive text-center">{t('Muted')}</span>
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Unmute user')}?</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Are you sure you want to unmute this user? This will restore the follow button.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnmute}>
              {t('Unmute')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return isFollowing ? (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          className="rounded-full min-w-28"
          variant={hover ? 'destructive' : 'secondary'}
          disabled={updating}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          {updating ? (
            <Skeleton className="mx-auto size-4 shrink-0 rounded-full" aria-hidden />
          ) : hover ? (
            t('Unfollow')
          ) : (
            t('buttonFollowing')
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('Unfollow')}?</AlertDialogTitle>
          <AlertDialogDescription>
            {t('Are you sure you want to unfollow this user?')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={handleUnfollow} variant="destructive">
            {t('Unfollow')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : (
    <Button className="rounded-full min-w-28" onClick={handleFollow} disabled={updating}>
      {updating ? <Skeleton className="mx-auto size-4 shrink-0 rounded-full" aria-hidden /> : t('Follow')}
    </Button>
  )
}
