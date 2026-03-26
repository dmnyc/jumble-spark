import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  isZapPollPastDeadline,
  isZapPollVoteEligible,
  userHasZappedPoll,
  userZapPollVoteOption
} from '@/lib/zap-poll'
import { useZapPollMeta, useZapPollTally } from '@/hooks/useZapPollTally'
import { useNostrOptional } from '@/providers/nostr-context'
import lightning from '@/services/lightning.service'
import { Zap } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import dayjs from 'dayjs'

export default function ZapPoll({
  event,
  className,
  voteHighlightOptionIndex
}: {
  event: Event
  className?: string
  /** When showing this poll because the profile user voted, highlight that option. */
  voteHighlightOptionIndex?: number
}) {
  const { t } = useTranslation()
  const nostr = useNostrOptional()
  const pubkey = nostr?.pubkey ?? null
  const meta = useZapPollMeta(event)
  const { receipts, tally, loading, error, reload } = useZapPollTally(event, meta)

  const [recipientPk, setRecipientPk] = useState<string>('')
  const [optionIndex, setOptionIndex] = useState<number | null>(null)
  const [sats, setSats] = useState<number>(21)
  const [zapping, setZapping] = useState(false)

  useEffect(() => {
    if (meta?.valueMinimum != null) {
      setSats(Math.max(meta.valueMinimum, 1))
    } else {
      setSats(21)
    }
  }, [meta?.valueMinimum, event.id])

  const defaultRecipient = meta?.recipients[0]?.pubkey ?? ''
  const effectiveRecipient = recipientPk || defaultRecipient

  const closed = meta ? isZapPollPastDeadline(event, meta) : false
  const viewerZapped = pubkey && meta ? userHasZappedPoll(event.id, pubkey, receipts) : false
  const myVoteOption =
    pubkey && meta ? userZapPollVoteOption(event.id, pubkey, receipts) : undefined

  const showTally = !!meta && (closed || viewerZapped || event.pubkey === pubkey)

  const satsBounds = useMemo(() => {
    if (!meta) return { min: 1, max: undefined as number | undefined }
    return {
      min: Math.max(1, meta.valueMinimum ?? 1),
      max: meta.valueMaximum
    }
  }, [meta])

  if (!meta) {
    return (
      <div className={cn('text-sm text-muted-foreground rounded-lg border border-border p-3', className)}>
        {t('Invalid zap poll')}
      </div>
    )
  }

  const handleZapVote = async () => {
    if (!pubkey) {
      nostr?.startLogin()
      return
    }
    if (optionIndex === null) {
      toast.error(t('Select an option'))
      return
    }
    const eligible = isZapPollVoteEligible(event, meta, pubkey, sats)
    if (!eligible.ok) {
      toast.error(eligible.reason)
      return
    }
    setZapping(true)
    try {
      const result = await lightning.zapPollVote(
        pubkey,
        event,
        meta,
        effectiveRecipient,
        optionIndex,
        sats,
        '',
        undefined
      )
      if (result) {
        toast.success(t('Zap sent'))
        await reload()
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setZapping(false)
    }
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card/40 p-3 space-y-3', className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <Zap className="size-4 shrink-0" aria-hidden />
        <span>{t('Zap poll (paid votes)')}</span>
      </div>
      {voteHighlightOptionIndex != null && (
        <p className="text-xs text-muted-foreground">{t('You voted on this poll (zap receipt)')}</p>
      )}
      {meta.closedAt && (
        <p className="text-xs text-muted-foreground">
          {closed
            ? t('Poll closed {{time}}', {
                time: dayjs.unix(meta.closedAt).format('lll')
              })
            : t('Closes {{time}}', { time: dayjs.unix(meta.closedAt).format('lll') })}
        </p>
      )}
      {(meta.valueMinimum != null || meta.valueMaximum != null) && (
        <p className="text-xs text-muted-foreground">
          {t('Vote size')}:{' '}
          {meta.valueMinimum != null && meta.valueMaximum != null
            ? meta.valueMinimum === meta.valueMaximum
              ? t('{{n}} sats (fixed)', { n: meta.valueMinimum })
              : t('{{min}}–{{max}} sats', { min: meta.valueMinimum, max: meta.valueMaximum })
            : meta.valueMinimum != null
              ? t('≥ {{n}} sats', { n: meta.valueMinimum })
              : t('≤ {{n}} sats', { n: meta.valueMaximum! })}
        </p>
      )}
      {loading && !tally && (
        <p className="text-xs text-muted-foreground">{t('Loading tally…')}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="space-y-2">
        {meta.options.map((opt) => {
          const satsOpt = tally?.satsByOption.get(opt.index) ?? 0
          const pct = tally && tally.totalSats > 0 ? (100 * satsOpt) / tally.totalSats : 0
          const counts = tally?.receiptCountByOption.get(opt.index) ?? 0
          const isMine =
            myVoteOption === opt.index || voteHighlightOptionIndex === opt.index
          return (
            <div
              key={opt.index}
              className={cn(
                'relative overflow-hidden rounded-md border border-border/80',
                isMine && 'ring-2 ring-primary/50'
              )}
            >
              {showTally && tally && tally.totalSats > 0 && (
                <div
                  className="absolute inset-y-0 left-0 bg-primary/15"
                  style={{ width: `${pct}%` }}
                />
              )}
              <div className="relative flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm break-words">{opt.label}</span>
                {showTally && tally && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {satsOpt > 0 ? `${Math.round(satsOpt)} sats` : '—'}
                    {counts > 0 ? ` · ${t('{{n}} zaps', { n: counts })}` : ''}
                    {tally.totalSats > 0 ? ` (${pct.toFixed(0)}%)` : ''}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {meta.consensusThreshold != null && showTally && tally && tally.totalSats > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('Consensus threshold')}: {meta.consensusThreshold}%
        </p>
      )}
      {!closed && pubkey && event.pubkey !== pubkey && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="space-y-1">
            <Label className="text-xs">{t('Pay to')}</Label>
            <Select
              value={effectiveRecipient}
              onValueChange={(v) => setRecipientPk(v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={t('Recipient')} />
              </SelectTrigger>
              <SelectContent>
                {meta.recipients.map((r) => (
                  <SelectItem key={r.pubkey} value={r.pubkey}>
                    {r.pubkey.slice(0, 12)}…
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('Option')}</Label>
            <Select
              value={optionIndex !== null ? String(optionIndex) : ''}
              onValueChange={(v) => setOptionIndex(parseInt(v, 10))}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={t('Select option')} />
              </SelectTrigger>
              <SelectContent>
                {meta.options.map((o) => (
                  <SelectItem key={o.index} value={String(o.index)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('Sats')}</Label>
            <Input
              type="number"
              min={satsBounds.min}
              max={satsBounds.max}
              value={sats}
              onChange={(e) => setSats(parseInt(e.target.value, 10) || 0)}
              className="h-9"
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="w-full gap-2"
            disabled={zapping || optionIndex === null}
            onClick={() => void handleZapVote()}
          >
            <Zap className="size-4" />
            {zapping ? t('Zapping…') : t('Vote with zap')}
          </Button>
        </div>
      )}
      {showTally && (
        <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => void reload()}>
          {t('Refresh tally')}
        </Button>
      )}
    </div>
  )
}
