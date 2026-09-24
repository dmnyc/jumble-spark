import { forwardRef, useCallback, useMemo, useRef, useState } from 'react'
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
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { fitsNip46Request } from '@/lib/nip46'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import {
  applyLazarusPrivateTags,
  buildLazarusRecoveryDraft,
  computeLazarusDelta,
  getContentEncryption,
  getLazarusItemRange,
  getLazarusKindProfiles,
  parsePrivateTags,
  scanLazarusKind,
  type LazarusCandidate,
  type LazarusDelta,
  type LazarusItemCount,
  type LazarusKindProfile,
  type LazarusScanResult
} from '@/services/lazarus'
import type { Event } from 'nostr-tools'

const KIND_PROFILES = getLazarusKindProfiles()

type Phase = 'idle' | 'scanning' | 'done' | 'error'

/** Why a candidate's private items weren't decrypted */
type PrivateItemsNote = 'too-large' | 'failed' | 'unavailable'

function formatTimestamp(seconds: number): string {
  return dayjs.unix(seconds).format('YYYY-MM-DD HH:mm')
}

function formatItemRange(itemCount: LazarusItemCount): string {
  const { min, max } = getLazarusItemRange(itemCount)
  return min === max ? `${min}` : `≈ ${min}–${max}`
}

function CandidateRow({
  profile,
  candidate,
  decrypting,
  privateItemsNote,
  onPick
}: {
  profile: LazarusKindProfile
  candidate: LazarusCandidate
  decrypting: boolean
  privateItemsNote?: PrivateItemsNote
  onPick: (candidate: LazarusCandidate) => void
}) {
  const { t } = useTranslation()
  const range = getLazarusItemRange(candidate.itemCount)
  const { privateCount, privateEstimate, partial } = candidate.itemCount
  const isEmpty = range.max === 0
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
            {range.min === range.max
              ? t('{{count}} items', { count: range.min })
              : t('≈ {{min}}–{{max}} items', { min: range.min, max: range.max })}
          </span>
          {!!privateCount && (
            <span className="text-xs text-muted-foreground">
              {t('{{count}} private', { count: privateCount })}
            </span>
          )}
          {privateEstimate && (
            <span
              className="text-xs text-warning"
              title={t(
                'Estimated from the size of the encrypted private items, which could not be decrypted.'
              )}
            >
              {t('encrypted, estimated')}
            </span>
          )}
          {partial && !privateEstimate && (
            <span
              className="text-xs text-warning"
              title={t('Some private items could not be decrypted, so this count may be higher.')}
            >
              {t('partial count')}
            </span>
          )}
          {decrypting && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {badge && <span className="text-xs text-muted-foreground">({badge})</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {formatTimestamp(candidate.event.created_at)}
          {candidate.foundOn.length > 0 &&
            ` · ${t('found on {{count}} relays', { count: candidate.foundOn.length })}`}
        </div>
        {privateItemsNote === 'too-large' && (
          <div className="text-xs text-muted-foreground">
            {t('Too large to decrypt through a remote signer')}
          </div>
        )}
        {privateItemsNote === 'failed' && (
          <div className="text-xs text-muted-foreground">
            {t('Could not decrypt the private items')}
          </div>
        )}
      </div>
      {!candidate.isCurrent && (
        <Button variant="outline" size="sm" onClick={() => onPick(candidate)}>
          {t('Review')}
        </Button>
      )}
    </div>
  )
}

const LazarusSettingsPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { pubkey, account, signEvent, nip04Decrypt, nip44Decrypt } = useNostr()
  const [kind, setKind] = useState<number>(3)
  const [phase, setPhase] = useState<Phase>('idle')
  const [scan, setScan] = useState<LazarusScanResult | undefined>()
  const [pending, setPending] = useState<
    | {
        profile: LazarusKindProfile
        candidate: LazarusCandidate
        delta: LazarusDelta
        tooLargeForRemoteSigner: boolean
      }
    | undefined
  >()
  const [recovering, setRecovering] = useState(false)
  const [privateTags, setPrivateTags] = useState<Map<string, string[][]>>(new Map())
  const [privateItemsNotes, setPrivateItemsNotes] = useState<Record<string, PrivateItemsNote>>({})
  const [decrypting, setDecrypting] = useState(false)
  // Bumped whenever a new scan starts, so a slow decryption can't land on a newer scan
  const scanIdRef = useRef(0)
  const usesRemoteSigner = account?.signerType === 'bunker'

  const profile = useMemo(
    () => KIND_PROFILES.find((p) => p.kind === kind) ?? KIND_PROFILES[0],
    [kind]
  )

  /**
   * Decrypt a version's private items (NIP-51) to count them. Reuses content
   * the app already decrypted, and skips what a remote signer can't take:
   * NIP-46 requests are NIP-44 encrypted, which caps them at 65,535 bytes.
   */
  const readPrivateTags = useCallback(
    async (event: Event): Promise<string[][] | PrivateItemsNote> => {
      const encryption = getContentEncryption(event.content)
      if (!encryption) return 'unavailable'
      const cached = await indexedDb.getDecryptedContent(event.id)
      if (cached) return parsePrivateTags(cached) ?? 'failed'
      if (!account || account.signerType === 'npub') return 'unavailable'
      const method = encryption === 'nip04' ? 'nip04_decrypt' : 'nip44_decrypt'
      if (usesRemoteSigner && !fitsNip46Request(method, [event.pubkey, event.content])) {
        return 'too-large'
      }
      const plainText =
        encryption === 'nip04'
          ? await nip04Decrypt(event.pubkey, event.content)
          : await nip44Decrypt(event.pubkey, event.content)
      await indexedDb.putDecryptedContent(event.id, plainText)
      return parsePrivateTags(plainText) ?? 'failed'
    },
    [account, usesRemoteSigner, nip04Decrypt, nip44Decrypt]
  )

  const countPrivateItems = useCallback(
    async (scanProfile: LazarusKindProfile, result: LazarusScanResult, scanId: number) => {
      const encrypted = result.candidates.filter((c) => getContentEncryption(c.event.content))
      if (!scanProfile.privateItemTypes || encrypted.length === 0) return
      setDecrypting(true)
      const decrypted = new Map<string, string[][]>()
      const notes: Record<string, PrivateItemsNote> = {}
      // One at a time, so a signer that prompts shows one request at a time
      for (const { event } of encrypted) {
        try {
          const tags = await readPrivateTags(event)
          if (typeof tags === 'string') notes[event.id] = tags
          else decrypted.set(event.id, tags)
        } catch {
          notes[event.id] = 'failed'
        }
        if (scanIdRef.current !== scanId) return
      }
      setPrivateTags(decrypted)
      setPrivateItemsNotes(notes)
      setScan(applyLazarusPrivateTags(scanProfile, result, decrypted))
      setDecrypting(false)
    },
    [readPrivateTags]
  )

  const runScan = useCallback(async () => {
    if (!pubkey) return
    const scanId = ++scanIdRef.current
    setPhase('scanning')
    setScan(undefined)
    setPrivateTags(new Map())
    setPrivateItemsNotes({})
    setDecrypting(false)
    try {
      const result = await scanLazarusKind(kind, pubkey)
      if (scanIdRef.current !== scanId) return
      setScan(result)
      setPhase('done')
      countPrivateItems(profile, result, scanId)
    } catch {
      if (scanIdRef.current === scanId) setPhase('error')
    }
  }, [kind, pubkey, profile, countPrivateItems])

  const pickCandidate = useCallback(
    (candidate: LazarusCandidate) => {
      if (!scan) return
      const delta = computeLazarusDelta(candidate.event, scan.current?.event, privateTags)
      const draft = buildLazarusRecoveryDraft(candidate.event)
      const tooLargeForRemoteSigner =
        usesRemoteSigner && !fitsNip46Request('sign_event', [JSON.stringify({ ...draft, pubkey })])
      setPending({ profile, candidate, delta, tooLargeForRemoteSigner })
    },
    [profile, scan, privateTags, usesRemoteSigner, pubkey]
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
      <SecondaryPageLayout ref={ref} index={index} title={t('Data recovery')}>
        <SettingsPageContainer>
          <SettingsGroup title={t('Data recovery')}>
            <SettingsRow title={t('Sign in to scan your relay history for lost data.')} />
          </SettingsGroup>
        </SettingsPageContainer>
      </SecondaryPageLayout>
    )
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Data recovery')}>
      <SettingsPageContainer>
        <SettingsGroup title={t('Data recovery')}>
          <SettingsRow
            title={t(
              'Scan your relays for older versions of your lists and profiles, and restore one if a client clobbered it. Scans are read-only. Nothing is published until you review the change and confirm.'
            )}
            layout="stacked"
          />
          {usesRemoteSigner && (
            <div className="mx-4 mb-3 flex items-start gap-2 rounded-md border p-2 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t(
                  'You are signed in with a remote signer. Lists over 64 KB, like a mute list with many private items or a big follow list, cannot be decrypted or restored through NIP-46. Use a browser extension signer (NIP-07) or a local key for those.'
                )}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 px-4 pb-3">
            <select
              className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm"
              value={kind}
              onChange={(e) => {
                scanIdRef.current += 1
                setKind(Number(e.target.value))
                setScan(undefined)
                setPhase('idle')
                setDecrypting(false)
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
                  {decrypting && (
                    <div className="py-1 text-xs text-muted-foreground">
                      {t('Decrypting private items…')}
                    </div>
                  )}
                  {scan.candidates.map((candidate) => (
                    <CandidateRow
                      key={candidate.event.id}
                      profile={profile}
                      candidate={candidate}
                      decrypting={
                        decrypting &&
                        !privateTags.has(candidate.event.id) &&
                        !!getContentEncryption(candidate.event.content)
                      }
                      privateItemsNote={privateItemsNotes[candidate.event.id]}
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
                {pending.delta.privateUnknown && (
                  <div className="flex items-start gap-2 rounded-md border p-2 text-xs">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {t(
                        'Private items in one of these versions could not be decrypted, so the changes above cover public items only. By size, the selected version has {{chosen}} items and your current one has {{current}}.',
                        {
                          chosen: formatItemRange(pending.candidate.itemCount),
                          current: scan?.current ? formatItemRange(scan.current.itemCount) : '0'
                        }
                      )}
                    </span>
                  </div>
                )}
                {pending.tooLargeForRemoteSigner && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive p-2 text-xs">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>
                      {t(
                        'This version is too large to sign with a remote signer: NIP-46 requests are limited to 64 KB. Large lists, like a mute list with many private items or a big follow list, can only be restored with a browser extension signer (NIP-07) or a local key.'
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
              <Button
                onClick={confirmRecovery}
                disabled={recovering || pending?.tooLargeForRemoteSigner}
              >
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
    </SecondaryPageLayout>
  )
})
LazarusSettingsPage.displayName = 'LazarusSettingsPage'
export default LazarusSettingsPage
