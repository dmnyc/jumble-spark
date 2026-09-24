import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import { ArchiveRestore, Loader2, ScanSearch, TriangleAlert } from 'lucide-react'
import { SettingsPageContainer, SettingsGroup, SettingsRow } from '@/components/ui/settings'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import {
  buildLazarusRecoveryDraft,
  computeLazarusDelta,
  getLazarusKindProfiles,
  scanLazarusKind,
  type LazarusCandidate,
  type LazarusDelta,
  type LazarusKindProfile,
  type LazarusScanResult
} from '@/services/lazarus'

const KIND_PROFILES = getLazarusKindProfiles()

type Phase = 'idle' | 'scanning' | 'done' | 'error'

function formatTimestamp(seconds: number): string {
  return dayjs.unix(seconds).format('YYYY-MM-DD HH:mm')
}

function CandidateRow({
  profile,
  candidate,
  onPick
}: {
  profile: LazarusKindProfile
  candidate: LazarusCandidate
  onPick: (candidate: LazarusCandidate) => void
}) {
  const { t } = useTranslation()
  const isEmpty = candidate.itemCount.count === 0
  const meaningfulEmpty = profile.meaningfulEmpty && isEmpty

  let badge: string | undefined
  if (candidate.isCurrent) badge = t('current')
  else if (candidate.isRecommended) badge = t('recommended')
  else if (meaningfulEmpty) badge = t('empty state')

  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">
            {t('{{count}} items', { count: candidate.itemCount.count })}
          </span>
          {candidate.itemCount.partial && (
            <span
              className="text-xs text-warning"
              title={t('Some private items could not be decrypted, so this count may be higher.')}
            >
              {t('partial count')}
            </span>
          )}
          {badge && <span className="text-xs text-muted-foreground">({badge})</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {formatTimestamp(candidate.event.created_at)}
          {candidate.foundOn.length > 0 &&
            ` · ${t('found on {{count}} relays', { count: candidate.foundOn.length })}`}
        </div>
      </div>
      {!candidate.isCurrent && (
        <Button variant="outline" size="sm" onClick={() => onPick(candidate)}>
          {t('Review')}
        </Button>
      )}
    </div>
  )
}

export default function LazarusSettingsPage() {
  const { t } = useTranslation()
  const { pubkey, signEvent } = useNostr()
  const [kind, setKind] = useState<number>(3)
  const [phase, setPhase] = useState<Phase>('idle')
  const [scan, setScan] = useState<LazarusScanResult | undefined>()
  const [pending, setPending] = useState<
    { profile: LazarusKindProfile; candidate: LazarusCandidate; delta: LazarusDelta } | undefined
  >()
  const [recovering, setRecovering] = useState(false)

  const profile = useMemo(
    () => KIND_PROFILES.find((p) => p.kind === kind) ?? KIND_PROFILES[0],
    [kind]
  )

  const runScan = useCallback(async () => {
    if (!pubkey) return
    setPhase('scanning')
    setScan(undefined)
    try {
      const result = await scanLazarusKind(kind, pubkey)
      setScan(result)
      setPhase('done')
    } catch {
      setPhase('error')
    }
  }, [kind, pubkey])

  const pickCandidate = useCallback(
    (candidate: LazarusCandidate) => {
      if (!scan) return
      const delta = computeLazarusDelta(candidate.event, scan.current?.event)
      setPending({ profile, candidate, delta })
    },
    [profile, scan]
  )

  const confirmRecovery = useCallback(async () => {
    if (!pending || !pubkey) return
    setRecovering(true)
    try {
      const draft = buildLazarusRecoveryDraft(pending.candidate.event)
      const signed = await signEvent(draft)
      await client.publishEvent(
        await client.determineRelaysByFilter({ kinds: [draft.kind], authors: [pubkey] }),
        signed
      )
      toast.success(t('Recovery published. It may take a moment to propagate.'))
      setPending(undefined)
      await runScan()
    } catch {
      toast.error(t('Could not publish the recovery event.'))
    } finally {
      setRecovering(false)
    }
  }, [pending, pubkey, signEvent, runScan, t])

  if (!pubkey) {
    return (
      <SettingsPageContainer>
        <SettingsGroup title={t('Data recovery')}>
          <SettingsRow title={t('Sign in to scan your relay history for lost data.')} />
        </SettingsGroup>
      </SettingsPageContainer>
    )
  }

  return (
    <SettingsPageContainer>
      <SettingsGroup title={t('Data recovery')}>
        <SettingsRow
          title={t(
            'Scan your relays for older versions of your lists and profiles, and restore one if a client clobbered it. Scans are read-only. Nothing is published until you review the change and confirm.'
          )}
          layout="stacked"
        />
        <div className="flex items-center gap-2 px-4 pb-3">
          <select
            className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm"
            value={kind}
            onChange={(e) => {
              setKind(Number(e.target.value))
              setScan(undefined)
              setPhase('idle')
            }}
          >
            {KIND_PROFILES.map((p) => (
              <option key={p.kind} value={p.kind}>
                {`k${p.kind} · ${p.name}`}
              </option>
            ))}
          </select>
          <Button onClick={runScan} disabled={phase === 'scanning'}>
            {phase === 'scanning' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ScanSearch className="h-4 w-4" />
            )}
            {t('Scan')}
          </Button>
        </div>
        {phase === 'error' && (
          <SettingsRow title={t('The scan failed. Check your relay connections and try again.')} />
        )}
        {phase === 'done' && scan && (
          <div className="px-4 pb-4">
            {scan.candidates.length === 0 ? (
              <div className="py-2 text-sm text-muted-foreground">
                {t(
                  'No versions found. This scan saw {{queried}} relays and {{responding}} answered, so an empty result may just mean the relays asked had no history.',
                  { queried: scan.queriedRelays.length, responding: scan.respondingRelays.length }
                )}
              </div>
            ) : (
              <>
                {scan.requiresIntentConfirmation && (
                  <div className="mb-2 flex items-start gap-2 rounded-md border p-2 text-xs">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {t(
                        'For this kind, an empty list can be intentional, so nothing is recommended. Choose the version you actually want.'
                      )}
                    </span>
                  </div>
                )}
                {scan.candidates.map((candidate) => (
                  <CandidateRow
                    key={candidate.event.id}
                    profile={profile}
                    candidate={candidate}
                    onPick={pickCandidate}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </SettingsGroup>

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Review recovery')}</DialogTitle>
            <DialogDescription>
              {t(
                'Restoring replaces your current {{kind}} list with the selected version.',
                { kind: pending?.profile.name ?? '' }
              )}
            </DialogDescription>
          </DialogHeader>
          {pending && (
            <div className="space-y-2 text-sm">
              <div>
                {t('{{count}} items would be added', { count: pending.delta.addedCount })}
                {' · '}
                {t('{{count}} items would be removed', { count: pending.delta.removedCount })}
              </div>
              {pending.delta.shrinks && (
                <div className="flex items-start gap-2 rounded-md border p-2 text-xs">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {t(
                      'This restores fewer items than you have now. It will also re-apply moderation from that version for mute lists.'
                    )}
                  </span>
                </div>
              )}
              {pending.profile.requiredWarnings.includes('remute') && pending.delta.removedCount > 0 && (
                <div className="text-xs text-muted-foreground">
                  {t(
                    'Accounts present now but missing from the restored version would be unmuted.'
                  )}
                </div>
              )}
              {pending.profile.requiredWarnings.includes('stale-relays') && (
                <div className="text-xs text-muted-foreground">
                  {t('Old relay lists can point at relays that no longer exist.')}
                </div>
              )}
              {pending.profile.requiredWarnings.includes('affects-others') && (
                <div className="text-xs text-muted-foreground">
                  {t('This list affects how other accounts interact with you.')}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(undefined)}>
              {t('Cancel')}
            </Button>
            <Button onClick={confirmRecovery} disabled={recovering}>
              {recovering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArchiveRestore className="h-4 w-4" />
              )}
              {t('Restore')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageContainer>
  )
}
