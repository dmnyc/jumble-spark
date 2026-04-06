import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import Uploader from '@/components/PostEditor/Uploader'
import ProfileBanner from '@/components/ProfileBanner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { createPaymentInfoDraftEvent, createProfileDraftEvent } from '@/lib/draft-event'
import { generateImageByPubkey } from '@/lib/pubkey'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ChevronDown, Fingerprint, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/** Required tag fields: always exactly one row, cannot be deleted. */
const SINGLETON_NAMES = ['display_name', 'name', 'about', 'picture', 'banner']
/**
 * Optional fields that may appear at most once.
 * Rows are deletable but a second instance is blocked.
 */
const UNIQUE_NAMES = ['bot', 'birthday']
/** Tags that may appear multiple times (nip05, lud16, website). */
const MULTI_NAMES = ['nip05', 'lud16', 'website']
/** Tags managed automatically by the client – hidden from the editor. */
const AUTO_NAMES = new Set(['alt', 'client'])
/** All "at most one" names (singletons + unique-optional). */
const AT_MOST_ONE_NAMES = [...SINGLETON_NAMES, ...UNIQUE_NAMES]
/** All named tags the editor knows about (label + display order). */
const KNOWN_NAMES = [...SINGLETON_NAMES, ...UNIQUE_NAMES, ...MULTI_NAMES]
/** Canonical display order for the tag list. */
const DISPLAY_ORDER = ['display_name', 'name', 'about', 'picture', 'banner', 'nip05', 'lud16', 'website', 'bot', 'birthday']
/** Options shown in the "add tag" dropdown, in this order. */
const ADD_TAG_OPTIONS = ['nip05', 'lud16', 'website', 'bot', 'birthday'] as const

const TAG_LABELS: Record<string, string> = {
  display_name: 'Display Name',
  name: 'Name',
  about: 'Bio',
  picture: 'Profile Picture',
  banner: 'Banner',
  nip05: 'Nostr Address (NIP-05)',
  lud16: 'Lightning Address',
  website: 'Website',
  bot: 'Bot',
  birthday: 'Birthday',
}

const ProfileEditorPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { pop } = useSecondaryPage()
  const {
    account,
    profile,
    profileEvent,
    publish,
    updateProfileEvent,
    relayList,
    requestAccountNetworkHydrate
  } = useNostr()

  const [hasChanged, setHasChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [paymentInfoEvent, setPaymentInfoEvent] = useState<Event | null>(null)
  const [paymentInfoEditOpen, setPaymentInfoEditOpen] = useState(false)
  const [paymentInfoEditContent, setPaymentInfoEditContent] = useState('')
  const [paymentInfoEditMethods, setPaymentInfoEditMethods] = useState<Array<{ type: string; authority: string }>>([])
  const [paymentInfoShowFullJson, setPaymentInfoShowFullJson] = useState(false)
  const [savingPaymentInfo, setSavingPaymentInfo] = useState(false)
  const [profileEventJson, setProfileEventJson] = useState<string>('')
  const [savingFullProfile, setSavingFullProfile] = useState(false)
  const [refreshingCache, setRefreshingCache] = useState(false)
  /** Single source of truth: all profile tags (excluding auto-managed client/alt). */
  const [profileTags, setProfileTags] = useState<string[][]>([])
  const [imageUrlField, setImageUrlField] = useState<'picture' | 'banner' | null>(null)
  const [imageUrlDraft, setImageUrlDraft] = useState('')
  const [tagToAdd, setTagToAdd] = useState<string>(ADD_TAG_OPTIONS[0])

  const defaultImage = useMemo(
    () => (account ? generateImageByPubkey(account.pubkey) : undefined),
    [account]
  )

  /** Derived from profileTags so uploaders and visual preview stay in sync. */
  const avatar = profileTags.find((t) => t[0] === 'picture')?.[1] ?? ''
  const banner = profileTags.find((t) => t[0] === 'banner')?.[1] ?? ''

  // Rebuild tag list whenever the stored profile event changes.
  useEffect(() => {
    setProfileTags(buildTagListFromEvent(profileEvent ?? null))
  }, [profileEvent])

  // Sync full-event JSON editor.
  useEffect(() => {
    setProfileEventJson(profileEvent ? JSON.stringify(profileEvent, null, 2) : '')
  }, [profileEvent])

  // Fetch payment info (kind 10133).
  useEffect(() => {
    if (!account?.pubkey) { setPaymentInfoEvent(null); return }
    let cancelled = false
    client
      .fetchPaymentInfoEvent(account.pubkey)
      .then((evt) => { if (!cancelled) setPaymentInfoEvent(evt ?? null) })
      .catch(() => { if (!cancelled) setPaymentInfoEvent(null) })
    return () => { cancelled = true }
  }, [account?.pubkey])

  // ─── Tag list helpers ────────────────────────────────────────────────────────

  const updateTagValue = (idx: number, value: string) => {
    setProfileTags((prev) => prev.map((t, i) => (i === idx ? [t[0], value, ...t.slice(2)] : t)))
    setHasChanged(true)
  }

  const updateTagName = (idx: number, name: string) => {
    // Prevent renaming to a name that may only appear once and is already occupied.
    if (AT_MOST_ONE_NAMES.includes(name)) {
      const existingIdx = profileTags.findIndex((t) => t[0] === name)
      if (existingIdx !== -1 && existingIdx !== idx) {
        toast.error(t('profileEditorDuplicateSingleton', { defaultValue: `"${name}" may only appear once` }))
        return
      }
    }
    setProfileTags((prev) => prev.map((t, i) => (i === idx ? [name, t[1] ?? '', ...t.slice(2)] : t)))
    setHasChanged(true)
  }

  const removeTag = (idx: number) => {
    setProfileTags((prev) => prev.filter((_, i) => i !== idx))
    setHasChanged(true)
  }

  const addTag = (name = '', value = '') => {
    // Prevent adding a second row for any "at most one" tag.
    if (name && AT_MOST_ONE_NAMES.includes(name) && profileTags.some((t) => t[0] === name)) {
      toast.error(t('profileEditorDuplicateSingleton', { defaultValue: `"${name}" may only appear once` }))
      return
    }
    setProfileTags((prev) => [...prev, [name, value]])
    setHasChanged(true)
  }

  // ─── Payment info ────────────────────────────────────────────────────────────

  const openPaymentInfoEditor = useCallback(() => {
    if (paymentInfoEvent) {
      setPaymentInfoEditContent(
        typeof paymentInfoEvent.content === 'string'
          ? paymentInfoEvent.content
          : JSON.stringify(paymentInfoEvent.content ?? '', null, 2)
      )
      const paytoTags = (paymentInfoEvent.tags ?? []).filter(
        (tag) => Array.isArray(tag) && tag[0] === 'payto' && tag[1] != null
      )
      setPaymentInfoEditMethods(
        paytoTags.length > 0
          ? paytoTags.map((tag) => ({
              type: (tag[1] as string) || 'lightning',
              authority: (tag[2] as string) || ''
            }))
          : [{ type: 'lightning', authority: '' }]
      )
    } else {
      setPaymentInfoEditContent('{}')
      setPaymentInfoEditMethods([{ type: 'lightning', authority: '' }])
    }
    setPaymentInfoShowFullJson(false)
    setPaymentInfoEditOpen(true)
  }, [paymentInfoEvent])

  const savePaymentInfo = useCallback(async () => {
    const tags: string[][] = paymentInfoEditMethods
      .filter((m) => m.authority.trim())
      .map((m) => ['payto', (m.type.trim() || 'lightning').toLowerCase(), m.authority.trim()])
    setSavingPaymentInfo(true)
    try {
      const contentStr = paymentInfoEditContent.trim() || '{}'
      try { JSON.parse(contentStr) } catch {
        toast.error(t('Invalid content JSON'))
        setSavingPaymentInfo(false)
        return
      }
      const draft = createPaymentInfoDraftEvent(contentStr, tags)
      const published = await publish(draft)
      await client.updatePaymentInfoCache(published)
      setPaymentInfoEvent(published)
      setPaymentInfoEditOpen(false)
      toast.success(t('Payment info updated'))
    } catch {
      toast.error(t('Failed to publish payment info'))
    } finally {
      setSavingPaymentInfo(false)
    }
  }, [paymentInfoEditContent, paymentInfoEditMethods, publish, t])

  // ─── Cache refresh ───────────────────────────────────────────────────────────

  const forceRefreshProfileAndPaymentCache = useCallback(async () => {
    if (!account?.pubkey) return
    setRefreshingCache(true)
    try {
      await requestAccountNetworkHydrate()
      await syncUserDeletionTombstones(account.pubkey, relayList)
      await client.forceRefreshProfileAndPaymentInfoCache(account.pubkey)
      const [profileEvt, paymentEvt] = await Promise.all([
        client.fetchProfileEvent(account.pubkey),
        client.fetchPaymentInfoEvent(account.pubkey)
      ])
      if (profileEvt) await updateProfileEvent(profileEvt)
      setPaymentInfoEvent(paymentEvt ?? null)
      toast.success(t('Profile and payment cache refreshed'))
    } catch {
      toast.error(t('Failed to refresh cache'))
    } finally {
      setRefreshingCache(false)
    }
  }, [account?.pubkey, relayList, requestAccountNetworkHydrate, updateProfileEvent, t])

  // ─── Guards ──────────────────────────────────────────────────────────────────

  if (!account) return null

  if (!profile) {
    const loadingControls = (
      <div className="pr-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={forceRefreshProfileAndPaymentCache}
          disabled={refreshingCache}
          className="gap-1.5"
        >
          {refreshingCache ? (
            <Skeleton className="size-3.5 shrink-0 rounded-sm" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t('Refresh cache')}
        </Button>
      </div>
    )
    return (
      <SecondaryPageLayout ref={ref} index={index} title="…" controls={loadingControls}>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground text-sm">
          <Skeleton className="h-4 w-48 rounded" />
          <p>
            {t('profileEditorProfileNotLoaded', {
              defaultValue: 'Profile not loaded. Try refreshing the cache.'
            })}
          </p>
        </div>
      </SecondaryPageLayout>
    )
  }

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const openImageUrlEditor = (field: 'picture' | 'banner') => {
    setImageUrlField(field)
    setImageUrlDraft(profileTags.find((t) => t[0] === field)?.[1] ?? '')
  }

  const applyImageUrlDraft = () => {
    if (!imageUrlField) return
    const v = imageUrlDraft.trim()
    setProfileTags((prev) => {
      const idx = prev.findIndex((t) => t[0] === imageUrlField)
      return idx >= 0
        ? prev.map((t, i) => (i === idx ? [imageUrlField, v, ...t.slice(2)] : t))
        : [...prev, [imageUrlField, v]]
    })
    setHasChanged(true)
    setImageUrlField(null)
  }

  const onBannerUploadSuccess = ({ url }: { url: string }) => {
    setProfileTags((prev) => {
      const idx = prev.findIndex((t) => t[0] === 'banner')
      return idx >= 0
        ? prev.map((t, i) => (i === idx ? ['banner', url, ...t.slice(2)] : t))
        : [...prev, ['banner', url]]
    })
    setHasChanged(true)
  }

  const onAvatarUploadSuccess = ({ url }: { url: string }) => {
    setProfileTags((prev) => {
      const idx = prev.findIndex((t) => t[0] === 'picture')
      return idx >= 0
        ? prev.map((t, i) => (i === idx ? ['picture', url, ...t.slice(2)] : t))
        : [...prev, ['picture', url]]
    })
    setHasChanged(true)
  }

  // ─── Save ─────────────────────────────────────────────────────────────────────

  const save = async () => {
    setSaving(true)
    setHasChanged(false)
    try {
      // Strip empty/incomplete rows, trim whitespace.
      const validTags = profileTags
        .filter((t) => Array.isArray(t) && t.length >= 2 && (t[0] ?? '').trim() && (t[1] ?? '').trim())
        .map((t) => [t[0].trim(), t[1].trim(), ...t.slice(2)])

      // Sort alphabetically by tag name (stable: same-name tags keep their relative order).
      const sortedTags = [...validTags]
        .sort((a, b) => a[0].localeCompare(b[0]))
        // Enforce at-most-one uniqueness: keep only the first occurrence.
        .filter((() => {
          const seen = new Set<string>()
          return (t: string[]) => {
            if (!AT_MOST_ONE_NAMES.includes(t[0])) return true
            if (seen.has(t[0])) return false
            seen.add(t[0])
            return true
          }
        })())

      // Derive content JSON: first occurrence of each known field.
      const content: Record<string, string> = {}
      const seenContent = new Set<string>()
      for (const tag of sortedTags) {
        const name = tag[0]
        if (DISPLAY_ORDER.includes(name) && !seenContent.has(name)) {
          content[name] = tag[1]
          seenContent.add(name)
        }
      }
      // Keep displayName alias for backward compatibility.
      if (content['display_name']) content['displayName'] = content['display_name']

      const draft = createProfileDraftEvent(JSON.stringify(content), sortedTags)
      const published = await publish(draft)
      await updateProfileEvent(published)
      pop()
    } catch {
      toast.error(t('Failed to publish profile'))
      setHasChanged(true)
    } finally {
      setSaving(false)
    }
  }

  const saveFullProfile = async () => {
    let parsed: { kind?: number; content?: string; tags?: string[][] }
    try {
      const raw = JSON.parse(profileEventJson.trim())
      if (raw === null || typeof raw !== 'object') throw new Error('Must be a JSON object')
      parsed = raw
      if (parsed.kind !== 0) throw new Error('kind must be 0')
      if (typeof parsed.content !== 'string') throw new Error('content must be a string')
      if (!Array.isArray(parsed.tags)) throw new Error('tags must be an array')
      parsed.tags.forEach((tag: unknown, i: number) => {
        if (!Array.isArray(tag)) throw new Error(`tag at index ${i} must be an array`)
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Invalid profile JSON'))
      return
    }
    setSavingFullProfile(true)
    try {
      const profileDraftEvent = createProfileDraftEvent(parsed.content!, parsed.tags ?? [])
      const newProfileEvent = await publish(profileDraftEvent)
      await updateProfileEvent(newProfileEvent)
      setProfileEventJson(JSON.stringify(newProfileEvent, null, 2))
      setHasChanged(false)
      toast.success(t('Profile updated'))
    } catch {
      toast.error(t('Failed to publish profile'))
    } finally {
      setSavingFullProfile(false)
    }
  }

  // ─── Controls ─────────────────────────────────────────────────────────────────

  const controls = (
    <div className="pr-3 flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={forceRefreshProfileAndPaymentCache}
        disabled={refreshingCache}
        className="gap-1.5"
        title={t('profileEditorRefreshCacheHint', {
          defaultValue:
            'Full account sync from relays (like Settings → Cache), deletion tombstones, then profile and payment info.'
        })}
      >
        {refreshingCache ? (
          <Skeleton className="size-3.5 shrink-0 rounded-sm" aria-hidden />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {t('Refresh cache')}
      </Button>
      <Button className="w-16 rounded-full" onClick={save} disabled={saving || !hasChanged}>
        {saving ? <Skeleton className="mx-auto h-4 w-12 rounded-md" aria-hidden /> : t('Save')}
      </Button>
    </div>
  )

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <SecondaryPageLayout ref={ref} index={index} title={profile.username} controls={controls}>
      {/* Banner & avatar uploaders */}
      <div className="relative bg-cover bg-center mb-2">
        <Uploader
          onUploadSuccess={onBannerUploadSuccess}
          onUploadStart={() => setUploadingBanner(true)}
          onUploadEnd={() => setUploadingBanner(false)}
          className="w-full relative cursor-pointer"
        >
          <ProfileBanner banner={banner} pubkey={account.pubkey} className="w-full aspect-[3/1]" />
          <div className="absolute top-0 bg-muted/30 w-full h-full flex flex-col justify-center items-center">
            {uploadingBanner ? (
              <Skeleton className="size-9 shrink-0 rounded-md" aria-hidden />
            ) : (
              <Upload size={36} />
            )}
          </div>
        </Uploader>
        <Uploader
          onUploadSuccess={onAvatarUploadSuccess}
          onUploadStart={() => setUploadingAvatar(true)}
          onUploadEnd={() => setUploadingAvatar(false)}
          className="w-24 h-24 absolute bottom-0 left-4 translate-y-1/2 border-4 border-background cursor-pointer rounded-full"
        >
          <Avatar className="w-full h-full">
            <AvatarImage src={avatar} className="object-cover object-center" />
            <AvatarFallback>
              <img src={defaultImage} />
            </AvatarFallback>
          </Avatar>
          <div className="absolute top-0 bg-muted/30 w-full h-full rounded-full flex flex-col justify-center items-center">
            {uploadingAvatar ? (
              <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />
            ) : (
              <Upload />
            )}
          </div>
        </Uploader>
      </div>

      <div className="pt-14 px-4 flex flex-col gap-4">
        {/* ── Unified tag list ── */}
        <Item>
          <Label className="text-muted-foreground">{t('Tag list')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('profileEditorTagListHint', {
              defaultValue:
                'All profile fields as tags. On save, tags are sorted by name; the first of each known field also populates the content JSON.'
            })}
          </p>
          <div className="space-y-1.5">
            {profileTags.map((tag, idx) => {
              const name = tag[0] ?? ''
              const value = tag[1] ?? ''
              const isSingleton = SINGLETON_NAMES.includes(name)
              const isKnown = KNOWN_NAMES.includes(name)
              const isPic = name === 'picture'
              const isBan = name === 'banner'

              if (isPic || isBan) {
                return (
                  <ProfileImageTagRow
                    key={idx}
                    tagName={name as 'picture' | 'banner'}
                    value={value}
                    onEdit={() => openImageUrlEditor(name as 'picture' | 'banner')}
                    onInsertThumb={() => {
                      const next = insertNostrBuildThumbUrl(value)
                      if (next) {
                        setProfileTags((prev) =>
                          prev.map((t, i) => (i === idx ? [name, next, ...t.slice(2)] : t))
                        )
                        setHasChanged(true)
                      }
                    }}
                    showThumbButton={isPic && canInsertNostrBuildThumb(value)}
                    t={t}
                  />
                )
              }

              return (
                <div key={idx} className="flex gap-2 items-start">
                  {/* Tag name: fixed label for known, editable input for custom */}
                  <div className="flex-none w-28 shrink-0">
                    {isKnown ? (
                      <p
                        className="text-xs font-medium text-muted-foreground pt-2 truncate"
                        title={TAG_LABELS[name] || name}
                      >
                        {TAG_LABELS[name] || name}
                      </p>
                    ) : (
                      <Input
                        value={name}
                        placeholder={t('Tag name')}
                        className="font-mono text-xs h-8"
                        onChange={(e) => updateTagName(idx, e.target.value)}
                      />
                    )}
                  </div>

                  {/* Value: textarea for bio, plain input for everything else */}
                  {name === 'about' ? (
                    <Textarea
                      className="flex-1 text-sm min-h-[5rem] resize-y"
                      value={value}
                      onChange={(e) => updateTagValue(idx, e.target.value)}
                    />
                  ) : (
                    <Input
                      className="flex-1 font-mono text-sm"
                      value={value}
                      onChange={(e) => updateTagValue(idx, e.target.value)}
                    />
                  )}

                  {/* Delete (singletons are permanent) */}
                  {!isSingleton && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
                      onClick={() => removeTag(idx)}
                      aria-label={t('Remove')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )
            })}

            {/* Add-tag row: dropdown + single + button */}
            <div className="flex gap-2 pt-1 items-center">
              <Select value={tagToAdd} onValueChange={setTagToAdd}>
                <SelectTrigger className="flex-1 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADD_TAG_OPTIONS.map((name) => (
                    <SelectItem key={name} value={name}>
                      {TAG_LABELS[name] || name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">{t('Custom tag…')}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => addTag(tagToAdd === '__custom__' ? '' : tagToAdd)}
                aria-label={t('Add tag')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Item>

        {/* ── Full profile event JSON (collapsible) ── */}
        {profileEvent && (
          <Item>
            <Collapsible defaultOpen={false}>
              <CollapsibleTrigger className="flex items-center gap-2 font-medium">
                <ChevronDown className="h-4 w-4 transition-transform [[data-state=open]_&]:rotate-180" />
                {t('Full profile event')}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4 space-y-4">
                <div>
                  <Label htmlFor="profile-event-json" className="text-muted-foreground">
                    {t('Event (JSON)')}
                  </Label>
                  <Textarea
                    id="profile-event-json"
                    className="mt-1 font-mono text-xs min-h-64"
                    value={profileEventJson}
                    onChange={(e) => {
                      setProfileEventJson(e.target.value)
                      setHasChanged(true)
                    }}
                    placeholder='{"id":"...","pubkey":"...","created_at":0,"kind":0,"tags":[],"content":"{}","sig":"..."}'
                  />
                </div>
                <Button
                  onClick={saveFullProfile}
                  disabled={savingFullProfile || !hasChanged}
                  className="gap-2"
                >
                  {savingFullProfile && (
                    <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />
                  )}
                  {savingFullProfile ? t('Saving…') : t('Save full profile')}
                </Button>
              </CollapsibleContent>
            </Collapsible>
          </Item>
        )}

        {/* ── Payment info (kind 10133) ── */}
        <Item>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-muted-foreground">{t('Payment info')} (kind 10133)</Label>
            <Button variant="outline" size="sm" onClick={openPaymentInfoEditor} className="shrink-0">
              <Pencil className="h-3.5 w-3.5 mr-1" />
              {paymentInfoEvent ? t('Edit payment info') : t('Add payment info')}
            </Button>
          </div>
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              <ChevronDown className="h-4 w-4 transition-transform [[data-state=open]_&]:rotate-180" />
              {t('Raw payment info event')}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-2">
              {paymentInfoEvent ? (
                <>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t('Content (JSON)')}</Label>
                    <pre className="mt-1 p-3 rounded-md bg-muted text-xs overflow-auto max-h-48 break-all whitespace-pre-wrap">
                      {paymentInfoEvent.content || '{}'}
                    </pre>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t('Tags')}</Label>
                    <pre className="mt-1 p-3 rounded-md bg-muted text-xs overflow-auto max-h-48">
                      {JSON.stringify(paymentInfoEvent.tags ?? [], null, 2)}
                    </pre>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('No payment info event yet. Click "Add payment info" to create one.')}
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>
        </Item>
      </div>

      {/* ── Dialogs ── */}

      {/* Edit picture/banner URL */}
      <Dialog
        open={imageUrlField !== null}
        onOpenChange={(open) => {
          if (!open) setImageUrlField(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {imageUrlField === 'picture'
                ? t('profileEditorEditPictureUrl', { defaultValue: 'Edit profile picture URL' })
                : t('profileEditorEditBannerUrl', { defaultValue: 'Edit banner URL' })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="profile-image-url-draft">{t('URL')}</Label>
            <Input
              id="profile-image-url-draft"
              className="font-mono text-sm"
              value={imageUrlDraft}
              onChange={(e) => setImageUrlDraft(e.target.value)}
              placeholder="https://"
            />
            <p className="text-xs text-muted-foreground">
              {t('profileEditorImageUrlHint', {
                defaultValue:
                  'Saved in kind 0 tags as picture or banner. You can paste a link from a previous upload instead of using the uploader above.'
              })}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImageUrlField(null)}>
              {t('Cancel')}
            </Button>
            <Button onClick={applyImageUrlDraft}>{t('Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit payment info */}
      <Dialog open={paymentInfoEditOpen} onOpenChange={setPaymentInfoEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('Edit payment info')} (kind 10133)</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto space-y-4">
            <Item>
              <Label className="text-muted-foreground">{t('Payment methods')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('NIP-A3 payto tags: type (e.g. lightning) and authority (e.g. user@domain.com).')}
              </p>
              <div className="space-y-2">
                {paymentInfoEditMethods.map((row, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input
                      placeholder={t('Type (e.g. lightning)')}
                      value={row.type}
                      onChange={(e) => {
                        const next = [...paymentInfoEditMethods]
                        next[idx] = { ...next[idx], type: e.target.value }
                        setPaymentInfoEditMethods(next)
                      }}
                      className="flex-1 max-w-[140px] font-mono text-sm"
                    />
                    <Input
                      placeholder={t('Authority (e.g. user@domain.com)')}
                      value={row.authority}
                      onChange={(e) => {
                        const next = [...paymentInfoEditMethods]
                        next[idx] = { ...next[idx], authority: e.target.value }
                        setPaymentInfoEditMethods(next)
                      }}
                      className="flex-1 font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setPaymentInfoEditMethods(paymentInfoEditMethods.filter((_, i) => i !== idx))
                      }
                      aria-label={t('Remove')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() =>
                    setPaymentInfoEditMethods([
                      ...paymentInfoEditMethods,
                      { type: 'lightning', authority: '' }
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('Add payment method')}
                </Button>
              </div>
            </Item>
            <Item>
              <Label htmlFor="payment-info-content">{t('Additional content (JSON)')}</Label>
              <Input
                id="payment-info-content"
                className="font-mono text-sm"
                value={paymentInfoEditContent}
                onChange={(e) => setPaymentInfoEditContent(e.target.value)}
                placeholder='{}'
              />
            </Item>
            <Item>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setPaymentInfoShowFullJson((v) => !v)}
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${paymentInfoShowFullJson ? 'rotate-180' : ''}`}
                />
                {t('Show full event JSON')}
              </Button>
              {paymentInfoShowFullJson && (
                <pre className="mt-2 p-3 rounded-md bg-muted text-xs overflow-auto max-h-48 break-all whitespace-pre-wrap border">
                  {JSON.stringify(
                    createPaymentInfoDraftEvent(
                      paymentInfoEditContent.trim() || '{}',
                      paymentInfoEditMethods
                        .filter((m) => m.authority.trim())
                        .map((m) => [
                          'payto',
                          (m.type.trim() || 'lightning').toLowerCase(),
                          m.authority.trim()
                        ])
                    ),
                    null,
                    2
                  )}
                </pre>
              )}
            </Item>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentInfoEditOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button onClick={savePaymentInfo} disabled={savingPaymentInfo} className="gap-2">
              {savingPaymentInfo && <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />}
              {savingPaymentInfo ? t('Saving…') : t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SecondaryPageLayout>
  )
})
ProfileEditorPage.displayName = 'ProfileEditorPage'
export default ProfileEditorPage

// ─── Pure helpers (no React) ──────────────────────────────────────────────────

/**
 * Build the unified tag list from a stored profile event.
 *
 * Merge strategy:
 *  1. Event `tags` (non-auto) in display order, then unknown tags alphabetically.
 *  2. Content JSON fields not already covered:
 *     - Singletons: added only if absent from tags (tags take precedence).
 *     - Multi-fields: added when the exact (name, value) pair is not yet present.
 *  3. Empty placeholder rows for any singleton still missing after steps 1–2.
 *  4. Final sort: known fields by DISPLAY_ORDER, unknown fields alphabetically.
 *     (Stable sort preserves relative order of same-name entries like multiple nip05.)
 */
function buildTagListFromEvent(event: Event | null): string[][] {
  let content: Record<string, unknown> = {}
  if (event?.content) {
    try { content = JSON.parse(event.content) } catch { /* ignore */ }
  }

  const normalizeTagName = (n: string) =>
    n === 'displayName' ? 'display_name' : n === 'username' ? 'name' : n

  const eventTags = (event?.tags ?? [])
    .filter((t) => Array.isArray(t) && !AUTO_NAMES.has((t as string[])[0]))
    .map((t) => {
      const norm = normalizeTagName((t as string[])[0])
      return norm !== (t as string[])[0] ? [norm, ...(t as string[]).slice(1)] : [...(t as string[])]
    }) as string[][]

  // Group event tags by name for fast singleton-check.
  const byName = new Map<string, string[][]>()
  for (const tag of eventTags) {
    const name = tag[0]
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name)!.push([...tag])
  }

  const result: string[][] = []
  const dedup = new Set<string>() // "name\0value" for multi-fields; just "name" for singletons

  const push = (tag: string[]) => {
    const name = tag[0]
    // Singletons: only one row per name ever.
    if (SINGLETON_NAMES.includes(name)) {
      if (dedup.has(name)) return
      dedup.add(name)
    } else {
      const key = `${name}\0${tag[1] ?? ''}`
      if (dedup.has(key)) return
      dedup.add(key)
    }
    result.push([...tag])
  }

  // 1a. Known tags in display order.
  for (const name of DISPLAY_ORDER) {
    for (const tag of byName.get(name) ?? []) push(tag)
  }
  // 1b. Unknown non-auto tags.
  for (const tag of eventTags) {
    if (!DISPLAY_ORDER.includes(tag[0])) push(tag)
  }

  // 2. Merge content JSON fields.
  for (const [rawKey, val] of Object.entries(content)) {
    if (typeof val !== 'string' || !val.trim()) continue
    const name = normalizeTagName(rawKey)
    if (AUTO_NAMES.has(name)) continue
    // For singletons: event tags take precedence; skip if already present.
    if (SINGLETON_NAMES.includes(name) && byName.has(name)) continue
    push([name, val.trim()])
  }

  // 3. Ensure all singletons have at least an empty placeholder.
  for (const name of SINGLETON_NAMES) {
    if (!result.some((t) => t[0] === name)) push([name, ''])
  }

  // 4. Sort: known fields by DISPLAY_ORDER index, unknown alphabetically.
  result.sort((a, b) => {
    const ai = DISPLAY_ORDER.indexOf(a[0])
    const bi = DISPLAY_ORDER.indexOf(b[0])
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a[0].localeCompare(b[0])
  })

  return result
}

/** Returns true when a nostr.build URL can gain a /thumb/ prefix. */
function canInsertNostrBuildThumb(url: string): boolean {
  const u = url.trim()
  if (!u) return false
  try {
    const parsed = new URL(u)
    if (!parsed.hostname.endsWith('nostr.build')) return false
    const p = parsed.pathname
    return p !== '/thumb' && !p.startsWith('/thumb/')
  } catch {
    return false
  }
}

/** Inserts /thumb/ into a nostr.build URL path, or returns null if not applicable. */
function insertNostrBuildThumbUrl(url: string): string | null {
  const u = url.trim()
  if (!canInsertNostrBuildThumb(u)) return null
  try {
    const parsed = new URL(u)
    const p = parsed.pathname || '/'
    parsed.pathname = '/thumb' + (p.startsWith('/') ? p : `/${p}`)
    return parsed.toString()
  } catch {
    return null
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProfileImageTagRow({
  tagName,
  value,
  onEdit,
  onInsertThumb,
  showThumbButton,
  t
}: {
  tagName: 'picture' | 'banner'
  value: string
  onEdit: () => void
  onInsertThumb: () => void
  showThumbButton: boolean
  t: (key: string, opts?: { defaultValue?: string }) => string
}) {
  const label = TAG_LABELS[tagName] || tagName
  return (
    <div className="flex gap-2 items-center">
      <p className="flex-none w-28 text-xs font-medium text-muted-foreground truncate" title={label}>
        {label}
      </p>
      <Input
        readOnly
        value={value}
        className="flex-1 font-mono text-sm bg-muted/40"
        tabIndex={-1}
        title={value || undefined}
      />
      {showThumbButton && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          onClick={onInsertThumb}
          title={t('profileEditorNostrBuildThumbHint', {
            defaultValue: 'Use nostr.build thumbnail URL (/thumb/…)'
          })}
          aria-label={t('profileEditorNostrBuildThumbHint', {
            defaultValue: 'Use nostr.build thumbnail URL (/thumb/…)'
          })}
        >
          <Fingerprint className="h-4 w-4" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground"
        onClick={onEdit}
        aria-label={t('Edit')}
        title={t('Edit')}
      >
        <Pencil className="h-4 w-4" />
      </Button>
    </div>
  )
}

function Item({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2">{children}</div>
}
