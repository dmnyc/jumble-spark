import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { TProfileBadge } from '@/hooks/useProfileBadges'
import { fetchBadgeRecipientPubkeys } from '@/lib/fetch-badge-recipient-pubkeys'
import { toNote, toProfile } from '@/lib/link'
import { hexPubkeysEqual } from '@/lib/pubkey'
import { useSecondaryPage } from '@/PageManager'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function parseIssuerPubkeyFromATag(aTag: string): string | undefined {
  const parts = aTag.split(':')
  if (parts.length < 2) return undefined
  const pk = parts[1]
  return /^[0-9a-f]{64}$/i.test(pk) ? pk.toLowerCase() : undefined
}

export default function ProfileBadgeDetailDialog({
  open,
  onOpenChange,
  badge,
  profilePubkey,
  relayUrls
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  badge: TProfileBadge | null
  profilePubkey: string
  relayUrls: string[]
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const [recipientPubkeys, setRecipientPubkeys] = useState<string[]>([])
  const [recipientsLoading, setRecipientsLoading] = useState(false)
  const [recipientsError, setRecipientsError] = useState(false)

  const issuerPubkey = useMemo(() => (badge ? parseIssuerPubkeyFromATag(badge.a) : undefined), [badge])

  const displayImage = badge?.image ?? badge?.thumb
  const displayThumb = badge?.thumb ?? badge?.image
  const label = badge?.name ?? badge?.a.split(':').pop() ?? ''

  useEffect(() => {
    if (!open || !badge) {
      setRecipientPubkeys([])
      setRecipientsError(false)
      setRecipientsLoading(false)
      return
    }

    if (relayUrls.length === 0) {
      setRecipientPubkeys([])
      setRecipientsError(true)
      return
    }

    let cancelled = false
    setRecipientsLoading(true)
    setRecipientsError(false)
    fetchBadgeRecipientPubkeys(relayUrls, badge.a)
      .then((pubkeys) => {
        if (cancelled) return
        pubkeys.sort((a, b) => a.localeCompare(b))
        setRecipientPubkeys(pubkeys)
      })
      .catch(() => {
        if (!cancelled) {
          setRecipientsError(true)
          setRecipientPubkeys([])
        }
      })
      .finally(() => {
        if (!cancelled) setRecipientsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, badge, relayUrls])

  const otherRecipients = useMemo(
    () => recipientPubkeys.filter((pk) => !hexPubkeysEqual(pk, profilePubkey)),
    [recipientPubkeys, profilePubkey]
  )

  if (!badge) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{t('Badge details')}</DialogTitle>
          <DialogDescription className="sr-only">{label}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-2">
          {displayImage || displayThumb ? (
            <img
              src={displayImage ?? displayThumb}
              alt={label}
              className="max-h-48 w-auto max-w-full rounded-lg border object-contain bg-muted"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex size-32 items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">
              {label.slice(0, 3)}
            </div>
          )}
          <div className="text-center text-base font-semibold">{label}</div>
        </div>

        {badge.description ? (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
            {badge.description}
          </p>
        ) : null}

        {issuerPubkey ? (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">{t('Issued by')}</div>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-left hover:bg-muted/60"
              onClick={() => push(toProfile(issuerPubkey))}
            >
              <UserAvatar userId={issuerPubkey} size="small" className="shrink-0" />
              <Username userId={issuerPubkey} className="truncate text-sm font-medium" skeletonClassName="h-4" />
            </button>
          </div>
        ) : null}

        <div className="space-y-1 min-h-0 flex-1 flex flex-col">
          <div className="text-xs font-medium text-muted-foreground">{t('Other recipients')}</div>
          {recipientsLoading ? (
            <div className="text-sm text-muted-foreground py-2">{t('Loading...')}</div>
          ) : recipientsError ? (
            <div className="text-sm text-muted-foreground py-2">{t('Recipients could not be loaded')}</div>
          ) : otherRecipients.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">{t('No other recipients found')}</div>
          ) : (
            <ScrollArea className="h-44 rounded-md border">
              <ul className="p-1 space-y-0.5">
                {otherRecipients.map((pk) => (
                  <li key={pk}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/80"
                      onClick={() => push(toProfile(pk))}
                    >
                      <UserAvatar userId={pk} size="small" className="shrink-0" />
                      <Username userId={pk} className="truncate text-sm" skeletonClassName="h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>

        <Button type="button" variant="secondary" className="w-full" onClick={() => push(toNote(badge.awardId))}>
          {t('View award')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
