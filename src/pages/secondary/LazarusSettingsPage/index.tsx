import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import {
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Loader2,
  ScanSearch,
  TriangleAlert
} from 'lucide-react'
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
  checkLazarusCurrent,
  computeLazarusDelta,
  computeLazarusProfileChanges,
  fitsLazarusRemoteRestore,
  getContentEncryption,
  getLazarusItemRange,
  getLazarusKindProfiles,
  getLazarusPublishRelays,
  groupLazarusCandidates,
  isPastEmptyVersion,
  lazarusScanReachedNoRelay,
  loadOlderLazarusVersions,
  parsePrivateTags,
  publishLazarusRecovery,
  readLazarusCurrent,
  scanLazarusKind,
  sortLazarusCandidates,
  type LazarusCandidate,
  type LazarusDelta,
  type LazarusItemCount,
  type LazarusKindProfile,
  type LazarusProfileChange,
  type LazarusScanResult,
  type LazarusSortOrder
} from '@/services/lazarus'
import { kinds, type Event } from 'nostr-tools'

const KIND_PROFILES = getLazarusKindProfiles()

type Phase = 'idle' | 'scanning' | 'done' | 'error'

/** Why a candidate's private items weren't decrypted */
type PrivateItemsNote = 'too-large' | 'failed' | 'unavailable'

function formatTimestamp(seconds: number): string {
  return dayjs.unix(seconds).format('YYYY-MM-DD HH:mm')
}

function formatDate(seconds: number): string {
  return dayjs.unix(seconds).format('YYYY-MM-DD')
}

function formatItemRange(itemCount: LazarusItemCount): string {
  const { min, max } = getLazarusItemRange(itemCount)
  return min === max ? `${min}` : `≈ ${min}–${max}`
}

function ScanNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-md border p-2 text-xs">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function CandidateRow({
  profile,
  candidate,
  decrypting,
  privateItemsNote,
  tooLargeToRestore,
  preparing,
  restorable,
  onPick
}: {
  profile: LazarusKindProfile
  candidate: LazarusCandidate
  decrypting: boolean
  privateItemsNote?: PrivateItemsNote
  tooLargeToRestore: boolean
  preparing: boolean
  restorable: boolean
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
        {privateItemsNote === 'too-large' ? (
          <div className="text-muted-foreground text-xs">
            {t('Too large for a remote signer to decrypt or restore')}
          </div>
        ) : (
          tooLargeToRestore && (
            <div className="text-muted-foreground text-xs">
              {t('Too large to restore with a remote signer')}
            </div>
          )
        )}
        {privateItemsNote === 'failed' && (
          <div className="text-xs text-muted-foreground">
            {t('Could not decrypt the private items')}
          </div>
        )}
      </div>
      {!candidate.isCurrent && restorable && (
        <Button variant="outline" size="sm" onClick={() => onPick(candidate)} disabled={preparing}>
          {preparing && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('Review')}
        </Button>
      )}
    </div>
  )
}

const LazarusSettingsPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const {
    pubkey,
    account,
    signEvent,
    nip04Decrypt,
    nip44Decrypt,
    updateFollowListEvent,
    updateMuteListEvent,
    updateBookmarkListEvent,
    updateProfileEvent,
    updateRelayListEvent
  } = useNostr()
  const [kind, setKind] = useState<number>(3)
  const [phase, setPhase] = useState<Phase>('idle')
  const [scan, setScan] = useState<LazarusScanResult | undefined>()
  const [pending, setPending] = useState<
    | {
        profile: LazarusKindProfile
        candidate: LazarusCandidate
        /** The version the review compares against */
        current: Event | undefined
        delta: LazarusDelta
        /** Field changes, for profiles, whose data isn't in tags */
        profileChanges?: LazarusProfileChange[]
        tooLargeForRemoteSigner: boolean
        /** The list changed after the review opened, so it was compared again */
        changedSinceReview?: boolean
      }
    | undefined
  >()
  const [recovering, setRecovering] = useState(false)
  const [privateTags, setPrivateTags] = useState<Map<string, string[][]>>(new Map())
  const [privateItemsNotes, setPrivateItemsNotes] = useState<Record<string, PrivateItemsNote>>({})
  const [decryptingIds, setDecryptingIds] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sortBy, setSortBy] = useState<LazarusSortOrder>('date')
  const [preparingReview, setPreparingReview] = useState<string>()
  const [showEmpty, setShowEmpty] = useState(false)
  const [showRelays, setShowRelays] = useState(false)
  // Bumped whenever a new scan starts, so a slow decryption can't land on a newer scan
  const scanIdRef = useRef(0)
  // The latest decrypted private items and notes, so decryptions that finish
  // out of order merge, and versions already tried aren't asked for again
  const privateTagsRef = useRef<Map<string, string[][]>>(new Map())
  const privateNotesRef = useRef<Record<string, PrivateItemsNote>>({})
  // Decryptions run one job after another, so a signer that prompts never
  // gets two requests at once, and a queued version isn't queued twice
  const decryptQueueRef = useRef<Promise<void>>(Promise.resolve())
  const queuedRef = useRef(new Set<string>())
  // Restore-size checks by event id, so each large list is serialized once
  const restoreFitsRef = useRef(new Map<string, boolean>())
  const usesRemoteSigner = account?.signerType === 'bunker'
  // View-only accounts have no key to sign with: they can scan but not restore
  const canRestore = !!account && account.signerType !== 'npub'

  const profile = useMemo(
    () => KIND_PROFILES.find((p) => p.kind === kind) ?? KIND_PROFILES[0],
    [kind]
  )
  // Size order only means something for list kinds, and lists every version
  // on its own row; newest first folds runs of small edits into groups
  const sortable = profile.ranking === 'count'
  // Past empty versions are clobber evidence, not something to restore, so
  // they stay hidden until asked for
  const bySize = useMemo(
    () =>
      scan && sortable && sortBy === 'size'
        ? sortLazarusCandidates(scan.candidates, 'size').filter(
            (candidate) => showEmpty || !isPastEmptyVersion(candidate, profile)
          )
        : undefined,
    [scan, sortable, sortBy, showEmpty, profile]
  )
  const listItems = useMemo(
    () => (scan ? groupLazarusCandidates(scan, profile, { hidePastEmpty: !showEmpty }) : []),
    [scan, profile, showEmpty]
  )
  const pastEmptyCount = useMemo(
    () => (scan ? scan.candidates.filter((c) => isPastEmptyVersion(c, profile)).length : 0),
    [scan, profile]
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

  /** Merge decrypted private items into the latest set and re-rank the scan with them. */
  const mergePrivateItems = useCallback(
    (
      scanProfile: LazarusKindProfile,
      decrypted: Map<string, string[][]>,
      notes: Record<string, PrivateItemsNote>
    ) => {
      const merged = new Map([...privateTagsRef.current, ...decrypted])
      privateTagsRef.current = merged
      privateNotesRef.current = { ...privateNotesRef.current, ...notes }
      setPrivateTags(merged)
      setPrivateItemsNotes(privateNotesRef.current)
      setScan((current) => current && applyLazarusPrivateTags(scanProfile, current, merged))
    },
    []
  )

  const isUndecrypted = useCallback(
    (candidate: LazarusCandidate) =>
      !!getContentEncryption(candidate.event.content) &&
      !privateTagsRef.current.has(candidate.event.id) &&
      !privateNotesRef.current[candidate.event.id],
    []
  )

  /**
   * Decrypt versions' private items, one version at a time and one job after
   * another. Versions decrypted or tried in the meantime are skipped.
   */
  const decryptVersions = useCallback(
    (scanProfile: LazarusKindProfile, candidates: LazarusCandidate[], scanId: number) => {
      const ids = candidates.map((c) => c.event.id)
      ids.forEach((id) => queuedRef.current.add(id))
      setDecryptingIds((prev) => new Set([...prev, ...ids]))
      const job = decryptQueueRef.current.then(async () => {
        const decrypted = new Map<string, string[][]>()
        const notes: Record<string, PrivateItemsNote> = {}
        for (const candidate of candidates) {
          if (scanIdRef.current !== scanId) return
          if (!isUndecrypted(candidate)) continue
          const { event } = candidate
          try {
            const tags = await readPrivateTags(event)
            if (typeof tags === 'string') notes[event.id] = tags
            else decrypted.set(event.id, tags)
          } catch {
            notes[event.id] = 'failed'
          }
        }
        if (scanIdRef.current === scanId) mergePrivateItems(scanProfile, decrypted, notes)
      })
      decryptQueueRef.current = job.catch(() => {})
      return job.finally(() => {
        ids.forEach((id) => queuedRef.current.delete(id))
        setDecryptingIds((prev) => {
          const next = new Set(prev)
          ids.forEach((id) => next.delete(id))
          return next
        })
      })
    },
    [isUndecrypted, readPrivateTags, mergePrivateItems]
  )

  // Decrypt what the list shows: versions on their own rows, plus expanded
  // groups unless each decryption is a remote signer request. Everything else
  // is decrypted when a version is reviewed.
  useEffect(() => {
    if (!profile.privateItemTypes) return
    const shown = listItems.flatMap((item) => {
      if (item.type === 'version') return [item.candidate]
      if (usesRemoteSigner || !expandedGroups.has(item.candidates[0].event.id)) return []
      return item.candidates
    })
    // The recommendation is pinned above the list, even when its group is folded
    if (scan?.recommended) shown.push(scan.recommended)
    const pending = shown.filter((c) => isUndecrypted(c) && !queuedRef.current.has(c.event.id))
    if (pending.length > 0) decryptVersions(profile, pending, scanIdRef.current)
  }, [scan, listItems, profile, expandedGroups, usesRemoteSigner, isUndecrypted, decryptVersions])

  // A scan belongs to the account it ran for, so switching accounts starts over
  useEffect(() => {
    scanIdRef.current += 1
    privateTagsRef.current = new Map()
    privateNotesRef.current = {}
    queuedRef.current = new Set()
    setScan(undefined)
    setPending(undefined)
    setPhase('idle')
    setPrivateTags(new Map())
    setPrivateItemsNotes({})
    setDecryptingIds(new Set())
    setExpandedGroups(new Set())
    setShowEmpty(false)
    setLoadingOlder(false)
  }, [pubkey])

  const isTooLargeToRestore = useCallback(
    (event: Event) => {
      if (!usesRemoteSigner || !pubkey) return false
      let fits = restoreFitsRef.current.get(event.id)
      if (fits === undefined) {
        fits = fitsLazarusRemoteRestore(event, pubkey)
        restoreFitsRef.current.set(event.id, fits)
      }
      return !fits
    },
    [usesRemoteSigner, pubkey]
  )

  const runScan = useCallback(async () => {
    if (!pubkey) return
    const scanId = ++scanIdRef.current
    setPhase('scanning')
    setScan(undefined)
    privateTagsRef.current = new Map()
    privateNotesRef.current = {}
    queuedRef.current = new Set()
    setPrivateTags(new Map())
    setPrivateItemsNotes({})
    setDecryptingIds(new Set())
    setExpandedGroups(new Set())
    setShowEmpty(false)
    setShowRelays(false)
    setLoadingOlder(false)
    try {
      const result = await scanLazarusKind(kind, pubkey)
      if (scanIdRef.current !== scanId) return
      setScan(result)
      setPhase('done')
    } catch {
      if (scanIdRef.current === scanId) setPhase('error')
    }
  }, [kind, pubkey])

  const loadOlder = useCallback(async () => {
    if (!pubkey || !scan) return
    const scanId = scanIdRef.current
    setLoadingOlder(true)
    try {
      const result = await loadOlderLazarusVersions(profile, scan, pubkey, privateTagsRef.current)
      if (scanIdRef.current !== scanId) return
      // Count what finished decrypting while this page loaded
      setScan(applyLazarusPrivateTags(profile, result, privateTagsRef.current))
    } catch {
      if (scanIdRef.current === scanId) toast.error(t('Could not load older versions.'))
    } finally {
      if (scanIdRef.current === scanId) setLoadingOlder(false)
    }
  }, [pubkey, scan, profile, t])

  const pickCandidate = useCallback(
    async (candidate: LazarusCandidate) => {
      if (!scan || preparingReview || !canRestore) return
      const scanId = scanIdRef.current
      // Decrypt what the review needs and isn't decrypted yet, so the changes
      // cover private items too
      const needed = [candidate, scan.current].filter(
        (c): c is LazarusCandidate => !!c && isUndecrypted(c)
      )
      if (profile.privateItemTypes && needed.length > 0) {
        setPreparingReview(candidate.event.id)
        try {
          await decryptVersions(profile, needed, scanId)
        } finally {
          setPreparingReview(undefined)
        }
        if (scanIdRef.current !== scanId) return
      }
      const tags = privateTagsRef.current
      const chosen =
        applyLazarusPrivateTags(profile, scan, tags).candidates.find(
          (c) => c.event.id === candidate.event.id
        ) ?? candidate
      const current = scan.current?.event
      setPending({
        profile,
        candidate: chosen,
        current,
        delta: computeLazarusDelta(chosen.event, current, tags),
        profileChanges:
          profile.kind === kinds.Metadata
            ? computeLazarusProfileChanges(chosen.event, current)
            : undefined,
        tooLargeForRemoteSigner: isTooLargeToRestore(chosen.event)
      })
    },
    [
      profile,
      scan,
      preparingReview,
      canRestore,
      isUndecrypted,
      decryptVersions,
      isTooLargeToRestore
    ]
  )

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /** Update the app's own copy of the list, so its next edit builds on the restored version. */
  const applyRestoreLocally = useCallback(
    async (signed: Event, chosen: Event) => {
      // Same content as the chosen version, so its decrypted private items carry over
      const decrypted = await indexedDb.getDecryptedContent(chosen.id)
      if (decrypted) await indexedDb.putDecryptedContent(signed.id, decrypted)
      switch (signed.kind) {
        case kinds.Contacts:
          return updateFollowListEvent(signed)
        case kinds.Mutelist: {
          const privateTags = decrypted
            ? parsePrivateTags(decrypted)
            : getContentEncryption(signed.content)
              ? undefined
              : []
          if (privateTags) return updateMuteListEvent(signed, privateTags)
          await indexedDb.putReplaceableEvent(signed)
          return
        }
        case kinds.BookmarkList:
          return updateBookmarkListEvent(signed)
        case kinds.Metadata:
          return updateProfileEvent(signed)
        case kinds.RelayList:
          return updateRelayListEvent(signed)
        default:
          await indexedDb.putReplaceableEvent(signed)
      }
    },
    [
      updateFollowListEvent,
      updateMuteListEvent,
      updateBookmarkListEvent,
      updateProfileEvent,
      updateRelayListEvent
    ]
  )

  /** Compare the review again, against a version that appeared after it opened. */
  const reviewAgainst = useCallback(
    async (current: Event) => {
      if (!pending) return
      const reviewProfile = pending.profile
      const latest: LazarusCandidate = {
        event: current,
        foundOn: [],
        itemCount: reviewProfile.itemCount(current),
        isCurrent: true,
        isRecommended: false
      }
      if (reviewProfile.privateItemTypes && isUndecrypted(latest)) {
        await decryptVersions(reviewProfile, [latest], scanIdRef.current)
      }
      const chosen = pending.candidate.event
      setPending({
        ...pending,
        current,
        delta: computeLazarusDelta(chosen, current, privateTagsRef.current),
        profileChanges:
          reviewProfile.kind === kinds.Metadata
            ? computeLazarusProfileChanges(chosen, current)
            : undefined,
        changedSinceReview: true
      })
    },
    [pending, isUndecrypted, decryptVersions]
  )

  const confirmRecovery = useCallback(async () => {
    if (!pending || !pubkey) return
    const chosen = pending.candidate.event
    // Only the account the list belongs to can restore it
    if (chosen.pubkey !== pubkey) {
      toast.error(t('This version belongs to another account. Switch back to it to restore.'))
      setPending(undefined)
      return
    }
    setRecovering(true)
    try {
      // The list may have changed since the review opened (another column,
      // device or client), and restoring over it would drop those edits
      const [answers, stored] = await Promise.all([
        readLazarusCurrent(chosen.kind, pubkey),
        indexedDb.getReplaceableEvent(pubkey, chosen.kind)
      ])
      const check = checkLazarusCurrent(pending.current, stored ?? undefined, answers)
      if (check.status === 'unconfirmed') {
        toast.error(
          t(
            'Could not reach your write relays to confirm the current version. Nothing was published.'
          )
        )
        return
      }
      if (check.status === 'changed') {
        await reviewAgainst(check.current)
        return
      }
      const draft = buildLazarusRecoveryDraft(chosen, { current: check.current })
      const signed = await signEvent(draft)
      if (signed.pubkey !== chosen.pubkey) {
        toast.error(t('This version belongs to another account. Switch back to it to restore.'))
        return
      }
      const { write, extra } = await getLazarusPublishRelays(pubkey, scan?.respondingRelays ?? [])
      await publishLazarusRecovery(write, signed)
      // The other relays that answered hold older copies of the list; replace
      // them where they accept it, without holding up the result
      if (extra.length > 0) client.publishEvent(extra, signed).catch(() => {})
      await applyRestoreLocally(signed, chosen)
      toast.success(t('Recovery published. It may take a moment to propagate.'))
      setPending(undefined)
      await runScan()
    } catch {
      toast.error(t('Could not publish the recovery event.'))
    } finally {
      setRecovering(false)
    }
  }, [pending, pubkey, scan, signEvent, runScan, reviewAgainst, applyRestoreLocally, t])

  const renderCandidate = (candidate: LazarusCandidate) => (
    <CandidateRow
      key={candidate.event.id}
      profile={profile}
      candidate={candidate}
      decrypting={decryptingIds.has(candidate.event.id) && !privateTags.has(candidate.event.id)}
      privateItemsNote={privateItemsNotes[candidate.event.id]}
      tooLargeToRestore={isTooLargeToRestore(candidate.event)}
      preparing={preparingReview === candidate.event.id}
      restorable={canRestore && !isPastEmptyVersion(candidate, profile)}
      onPick={pickCandidate}
    />
  )

  const renderGroup = (candidates: LazarusCandidate[], clobbered: boolean) => {
    const key = candidates[0].event.id
    const expanded = expandedGroups.has(key)
    const ranges = candidates.map((c) => getLazarusItemRange(c.itemCount))
    const min = Math.min(...ranges.map((range) => range.min))
    const max = Math.max(...ranges.map((range) => range.max))
    const estimated = candidates.some((c) => !!c.itemCount.privateEstimate)
    const newest = formatDate(candidates[0].event.created_at)
    const oldest = formatDate(candidates[candidates.length - 1].event.created_at)
    let size = t('{{min}}–{{max}} items', { min, max })
    if (min === max) size = t('{{count}} items', { count: min })
    else if (estimated) size = t('≈ {{min}}–{{max}} items', { min, max })
    return (
      <div key={`group-${key}`}>
        <button
          type="button"
          aria-expanded={expanded}
          className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between gap-2 py-1.5 text-start text-xs"
          onClick={() => toggleGroup(key)}
        >
          <span className="min-w-0 truncate">
            {t('{{count}} versions', { count: candidates.length })} · {size} ·{' '}
            {clobbered && <span className="text-warning">{t('sudden drops')} · </span>}
            {oldest === newest ? newest : `${oldest} – ${newest}`}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" />
          )}
        </button>
        {expanded && <div className="border-s ps-3">{candidates.map(renderCandidate)}</div>}
      </div>
    )
  }

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
          {!canRestore && (
            <div className="text-muted-foreground mx-4 mb-3 flex items-start gap-2 rounded-md border p-2 text-xs">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t(
                  'This account is view-only, so you can scan its history but not restore a version.'
                )}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 px-4 pb-3">
            <select
              className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm"
              value={kind}
              onChange={(e) => {
                scanIdRef.current += 1
                setKind(Number(e.target.value))
                setScan(undefined)
                setPhase('idle')
                setDecryptingIds(new Set())
                setExpandedGroups(new Set())
                setLoadingOlder(false)
              }}
            >
              {KIND_PROFILES.map((p) => (
                <option key={p.kind} value={p.kind}>
                  {`kind ${p.kind} · ${p.name}`}
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
              {scan.relayOutcomes && (
                <div className="text-muted-foreground mb-2 text-xs">
                  <button
                    type="button"
                    className="hover:text-foreground flex items-center gap-1"
                    onClick={() => setShowRelays((shown) => !shown)}
                  >
                    {t('{{answered}} of {{queried}} relays answered', {
                      answered: Object.values(scan.relayOutcomes).filter(
                        (outcome) => outcome === 'answered'
                      ).length,
                      queried: scan.queriedRelays.length
                    })}
                    {showRelays ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>
                  {showRelays && (
                    <ul className="mt-1 space-y-0.5">
                      {scan.queriedRelays.map((url) => (
                        <li key={url} className="flex justify-between gap-2">
                          <span className="truncate">{url}</span>
                          <span className="shrink-0">
                            {scan.relayOutcomes?.[url] === 'answered'
                              ? t('Answered')
                              : scan.relayOutcomes?.[url] === 'timed-out'
                                ? t('Timed out')
                                : t('Failed')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {lazarusScanReachedNoRelay(scan) ? (
                <ScanNotice>
                  {t(
                    'No relay finished answering, so these versions may be incomplete. Scan again to retry.'
                  )}
                </ScanNotice>
              ) : (
                !scan.currentConfirmed && (
                  <ScanNotice>
                    {scan.relayList === 'unknown'
                      ? t(
                          'Could not fetch your relay list, so the newest version found may not be current and nothing is recommended. Scan again to retry.'
                        )
                      : t(
                          'None of your write relays answered, so the newest version found may not be current and nothing is recommended. Scan again to retry.'
                        )}
                  </ScanNotice>
                )
              )}
              {scan.relayList === 'missing' && (
                <ScanNotice>
                  {t(
                    'No relay list found for this account, so the default relays stand in as its write relays.'
                  )}
                </ScanNotice>
              )}
              {scan.candidates.length === 0 ? (
                <div className="py-2 text-sm text-muted-foreground">
                  {t(
                    'No versions found. The relays that answered may have no history of this list.'
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
                  {decryptingIds.size > 0 && (
                    <div className="py-1 text-xs text-muted-foreground">
                      {t('Decrypting private items…')}
                    </div>
                  )}
                  {scan.recommended ? (
                    <div className="mb-2 rounded-md border px-2">
                      {renderCandidate(scan.recommended)}
                    </div>
                  ) : (
                    sortable &&
                    scan.currentConfirmed && (
                      <div className="text-muted-foreground mb-2 text-xs">
                        {t('No recoverable improvement found.')}
                      </div>
                    )
                  )}
                  {sortable && scan.candidates.length > 1 && (
                    <div className="text-muted-foreground mb-1 flex items-center justify-end gap-2 text-xs">
                      <span>{t('Sort by')}</span>
                      <select
                        className="h-7 rounded-md border bg-transparent px-2 text-xs"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as LazarusSortOrder)}
                      >
                        <option value="date">{t('Date')}</option>
                        <option value="size">{t('Size')}</option>
                      </select>
                    </div>
                  )}
                  {bySize
                    ? bySize.map(renderCandidate)
                    : listItems.map((item) =>
                        item.type === 'version'
                          ? renderCandidate(item.candidate)
                          : renderGroup(item.candidates, item.clobbered)
                      )}
                  {pastEmptyCount > 0 && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground py-1.5 text-start text-xs"
                      onClick={() => setShowEmpty((shown) => !shown)}
                    >
                      {showEmpty
                        ? t('Hide empty versions')
                        : t('Show {{count}} empty versions', { count: pastEmptyCount })}
                    </button>
                  )}
                  {Object.keys(scan.olderCursors ?? {}).length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      onClick={loadOlder}
                      disabled={loadingOlder}
                    >
                      {loadingOlder && <Loader2 className="h-4 w-4 animate-spin" />}
                      {t('Load older versions')}
                    </Button>
                  )}
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
                {t('Restoring replaces your current {{kind}} with the selected version.', {
                  kind: pending?.profile.name ?? ''
                })}
              </DialogDescription>
            </DialogHeader>
            {pending && (
              <div className="space-y-2 text-sm">
                {pending.changedSinceReview && (
                  <div className="flex items-start gap-2 rounded-md border p-2 text-xs">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {t(
                        'Your list changed since this review, so the changes above now compare against the newest version. Check them and restore again.'
                      )}
                    </span>
                  </div>
                )}
                {pending.profileChanges ? (
                  pending.profileChanges.length === 0 ? (
                    <div>{t('No profile fields would change.')}</div>
                  ) : (
                    <div className="space-y-2">
                      {pending.profileChanges.map((change) => (
                        <div key={change.field} className="text-xs">
                          <div className="font-medium">{change.field}</div>
                          <div dir="auto" className="break-words">
                            {change.to ?? '—'}
                          </div>
                          {change.from !== undefined && (
                            <div
                              dir="auto"
                              className="text-muted-foreground break-words line-through"
                            >
                              {change.from}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div>
                    {t('{{count}} items would be added', { count: pending.delta.addedCount })}
                    {' · '}
                    {t('{{count}} items would be removed', { count: pending.delta.removedCount })}
                  </div>
                )}
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
                          current: pending.current
                            ? formatItemRange(pending.profile.itemCount(pending.current))
                            : '0'
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
