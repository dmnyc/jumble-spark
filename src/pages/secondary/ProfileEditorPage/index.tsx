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
import { isEmail } from '@/lib/utils'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { ChevronDown, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const ProfileEditorPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { pop } = useSecondaryPage()
  const { account, profile, profileEvent, publish, updateProfileEvent } = useNostr()
  const [banner, setBanner] = useState<string>('')
  const [avatar, setAvatar] = useState<string>('')
  const [username, setUsername] = useState<string>('')
  const [about, setAbout] = useState<string>('')
  const [website, setWebsite] = useState<string>('')
  const [nip05, setNip05] = useState<string>('')
  const [nip05Error, setNip05Error] = useState<string>('')
  const [lightningAddress, setLightningAddress] = useState<string>('')
  const [lightningAddressError, setLightningAddressError] = useState<string>('')
  const [hasChanged, setHasChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [paymentInfoEvent, setPaymentInfoEvent] = useState<Event | null>(null)
  const [paymentInfoEditOpen, setPaymentInfoEditOpen] = useState(false)
  const [paymentInfoEditContent, setPaymentInfoEditContent] = useState('')
  /** Payment method rows for kind 10133: each is a payto tag ["payto", type, authority]. */
  const [paymentInfoEditMethods, setPaymentInfoEditMethods] = useState<Array<{ type: string; authority: string }>>([])
  const [paymentInfoShowFullJson, setPaymentInfoShowFullJson] = useState(false)
  const [savingPaymentInfo, setSavingPaymentInfo] = useState(false)
  /** Editable full profile event (whole event as JSON string); synced from profileEvent. */
  const [profileEventJson, setProfileEventJson] = useState<string>('')
  const [savingFullProfile, setSavingFullProfile] = useState(false)
  const [refreshingCache, setRefreshingCache] = useState(false)
  /** Editable tag list for kind 0 (e.g. lud16, nip05, website). Each row is [name, value]. */
  const [profileTags, setProfileTags] = useState<string[][]>([])
  const defaultImage = useMemo(
    () => (account ? generateImageByPubkey(account.pubkey) : undefined),
    [account]
  )

  useEffect(() => {
    if (profile) {
      setBanner(profile.banner ?? '')
      setAvatar(profile.avatar ?? '')
      setUsername(profile.original_username ?? '')
      setAbout(profile.about ?? '')
      setWebsite(profile.website ?? '')
      setNip05(profile.nip05 ?? '')
      setLightningAddress(profile.lightningAddress || '')
    } else {
      setBanner('')
      setAvatar('')
      setUsername('')
      setAbout('')
      setWebsite('')
      setNip05('')
      setLightningAddress('')
    }
  }, [profile])

  // Sync editable full profile event (entire event as JSON) from profileEvent
  useEffect(() => {
    if (profileEvent) {
      setProfileEventJson(JSON.stringify(profileEvent, null, 2))
    } else {
      setProfileEventJson('')
    }
  }, [profileEvent])

  // Sync tag list from profileEvent (kind 0 tags)
  useEffect(() => {
    if (profileEvent?.tags?.length) {
      setProfileTags(profileEvent.tags.map((t) => [...t]))
    } else {
      setProfileTags([])
    }
  }, [profileEvent])

  // Fetch payment info event (kind 10133) for current user
  useEffect(() => {
    if (!account?.pubkey) {
      setPaymentInfoEvent(null)
      return
    }
    let cancelled = false
    client
      .fetchPaymentInfoEvent(account.pubkey)
      .then((evt) => {
        if (!cancelled) setPaymentInfoEvent(evt ?? null)
      })
      .catch(() => {
        if (!cancelled) setPaymentInfoEvent(null)
      })
    return () => {
      cancelled = true
    }
  }, [account?.pubkey])

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
      let content = contentStr
      try {
        JSON.parse(contentStr)
      } catch {
        toast.error(t('Invalid content JSON'))
        setSavingPaymentInfo(false)
        return
      }
      const draft = createPaymentInfoDraftEvent(content, tags)
      const published = await publish(draft)
      await client.updatePaymentInfoCache(published)
      setPaymentInfoEvent(published)
      setPaymentInfoEditOpen(false)
      toast.success(t('Payment info updated'))
    } catch (err) {
      toast.error(t('Failed to publish payment info'))
    } finally {
      setSavingPaymentInfo(false)
    }
  }, [paymentInfoEditContent, paymentInfoEditMethods, publish, t])

  const save = async () => {
    if (nip05 && !isEmail(nip05)) {
      setNip05Error(t('Invalid NIP-05 address'))
      return
    }

    const oldProfileContent = profileEvent ? JSON.parse(profileEvent.content) : {}
    const newProfileContent = {
      ...oldProfileContent,
      display_name: username,
      displayName: username,
      name: oldProfileContent.name ?? username,
      about,
      website,
      nip05,
      banner,
      picture: avatar
    }

    if (lightningAddress) {
      if (isEmail(lightningAddress)) {
        newProfileContent.lud16 = lightningAddress
      } else if (lightningAddress.startsWith('lnurl')) {
        newProfileContent.lud06 = lightningAddress
      } else {
        setLightningAddressError(t('Invalid Lightning Address'))
        return
      }
    } else {
      delete newProfileContent.lud16
    }

    const tagsToSave = profileTags
      .filter((tag) => Array.isArray(tag) && tag.length >= 2 && tag[0].trim() && tag[1].trim())
      .map((tag) => [tag[0].trim(), tag[1].trim(), ...(tag.slice(2) || [])])
    setSaving(true)
    setHasChanged(false)
    const profileDraftEvent = createProfileDraftEvent(
      JSON.stringify(newProfileContent),
      tagsToSave
    )
    const newProfileEvent = await publish(profileDraftEvent)
    await updateProfileEvent(newProfileEvent)
    setSaving(false)
    pop()
  }

  const onBannerUploadSuccess = ({ url }: { url: string }) => {
    setBanner(url)
    setHasChanged(true)
  }

  const onAvatarUploadSuccess = ({ url }: { url: string }) => {
    setAvatar(url)
    setHasChanged(true)
  }

  const forceRefreshProfileAndPaymentCache = useCallback(async () => {
    if (!account?.pubkey) return
    setRefreshingCache(true)
    try {
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
  }, [account?.pubkey, updateProfileEvent, t])

  if (!account || !profile) return null

  const saveFullProfile = async () => {
    let parsed: { kind?: number; content?: string; tags?: string[][] }
    try {
      const raw = JSON.parse(profileEventJson.trim())
      if (raw === null || typeof raw !== 'object') throw new Error('Must be a JSON object')
      parsed = raw
      if (parsed.kind !== 0) throw new Error('kind must be 0')
      if (typeof parsed.content !== 'string') throw new Error('content must be a string')
      if (!Array.isArray(parsed.tags)) throw new Error('tags must be an array')
      parsed.tags.forEach((t: unknown, i: number) => {
        if (!Array.isArray(t)) throw new Error(`tag at index ${i} must be an array`)
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Invalid profile JSON'))
      return
    }
    setSavingFullProfile(true)
    try {
      const profileDraftEvent = createProfileDraftEvent(
        parsed.content!,
        parsed.tags ?? []
      )
      const newProfileEvent = await publish(profileDraftEvent)
      await updateProfileEvent(newProfileEvent)
      setProfileEventJson(JSON.stringify(newProfileEvent, null, 2))
      setHasChanged(false)
      toast.success(t('Profile updated'))
    } catch (err) {
      toast.error(t('Failed to publish profile'))
    } finally {
      setSavingFullProfile(false)
    }
  }

  const controls = (
    <div className="pr-3 flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={forceRefreshProfileAndPaymentCache}
        disabled={refreshingCache}
        className="gap-1.5"
        title={t('Force-refresh profile and payment info from relays')}
      >
        {refreshingCache ? <Skeleton className="size-3.5 shrink-0 rounded-sm" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" />}
        {t('Refresh cache')}
      </Button>
      <Button className="w-16 rounded-full" onClick={save} disabled={saving || !hasChanged}>
        {saving ? <Skeleton className="mx-auto h-4 w-12 rounded-md" aria-hidden /> : t('Save')}
      </Button>
    </div>
  )

  return (
    <SecondaryPageLayout ref={ref} index={index} title={profile.username} controls={controls}>
      <div className="relative bg-cover bg-center mb-2">
        <Uploader
          onUploadSuccess={onBannerUploadSuccess}
          onUploadStart={() => setUploadingBanner(true)}
          onUploadEnd={() => setUploadingBanner(false)}
          className="w-full relative cursor-pointer"
        >
          <ProfileBanner banner={banner} pubkey={account.pubkey} className="w-full aspect-[3/1]" />
          <div className="absolute top-0 bg-muted/30 w-full h-full flex flex-col justify-center items-center">
            {uploadingBanner ? <Skeleton className="size-9 shrink-0 rounded-md" aria-hidden /> : <Upload size={36} />}
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
            {uploadingAvatar ? <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden /> : <Upload />}
          </div>
        </Uploader>
      </div>
      <div className="pt-14 px-4 flex flex-col gap-4">
        <Item>
          <Label htmlFor="profile-username-input">{t('Display Name')}</Label>
          <Input
            id="profile-username-input"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              setHasChanged(true)
            }}
          />
        </Item>
        <Item>
          <Label htmlFor="profile-about-textarea">{t('Bio')}</Label>
          <Textarea
            id="profile-about-textarea"
            className="h-44"
            value={about}
            onChange={(e) => {
              setAbout(e.target.value)
              setHasChanged(true)
            }}
          />
        </Item>
        <Item>
          <Label htmlFor="profile-website-input">{t('Website')}</Label>
          <Input
            id="profile-website-input"
            value={website}
            onChange={(e) => {
              setWebsite(e.target.value)
              setHasChanged(true)
            }}
          />
        </Item>
        <Item>
          <Label htmlFor="profile-nip05-input">{t('Nostr Address (NIP-05)')}</Label>
          <Input
            id="profile-nip05-input"
            value={nip05}
            onChange={(e) => {
              setNip05Error('')
              setNip05(e.target.value)
              setHasChanged(true)
            }}
            className={nip05Error ? 'border-destructive' : ''}
          />
          {nip05Error && <div className="text-xs text-destructive pl-3">{nip05Error}</div>}
        </Item>
        <Item>
          <Label htmlFor="profile-lightning-address-input">
            {t('Lightning Address (or LNURL)')}
          </Label>
          <Input
            id="profile-lightning-address-input"
            value={lightningAddress}
            onChange={(e) => {
              setLightningAddressError('')
              setLightningAddress(e.target.value)
              setHasChanged(true)
            }}
            className={lightningAddressError ? 'border-destructive' : ''}
          />
          {lightningAddressError && (
            <div className="text-xs text-destructive pl-3">{lightningAddressError}</div>
          )}
        </Item>

        <Item>
          <Label className="text-muted-foreground">{t('Tag list')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('Profile event tags (e.g. lud16, nip05, website). Saved with kind 0.')}
          </p>
          <div className="space-y-2">
            {profileTags.map((tag, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input
                  placeholder={t('Tag name')}
                  value={tag[0] ?? ''}
                  onChange={(e) => {
                    const next = profileTags.map((t, i) => (i === idx ? [e.target.value, t[1] ?? '', ...(t.slice(2) ?? [])] : t))
                    setProfileTags(next)
                    setHasChanged(true)
                  }}
                  className="flex-1 max-w-[140px] font-mono text-sm"
                />
                <Input
                  placeholder={t('Tag value')}
                  value={tag[1] ?? ''}
                  onChange={(e) => {
                    const next = profileTags.map((t, i) => (i === idx ? [t[0] ?? '', e.target.value, ...(t.slice(2) ?? [])] : t))
                    setProfileTags(next)
                    setHasChanged(true)
                  }}
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setProfileTags(profileTags.filter((_, i) => i !== idx))
                    setHasChanged(true)
                  }}
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
              onClick={() => {
                setProfileTags([...profileTags, ['', '']])
                setHasChanged(true)
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('Add tag')}
            </Button>
          </div>
        </Item>

        {/* Full profile event (kind 0): editable entire event as JSON */}
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
                  {savingFullProfile && <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />}
                  {savingFullProfile ? t('Saving…') : t('Save full profile')}
                </Button>
              </CollapsibleContent>
            </Collapsible>
          </Item>
        )}

        {/* Payment info (kind 10133): stringified content + tags + Edit button */}
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
                <p className="text-sm text-muted-foreground">{t('No payment info event yet. Click "Add payment info" to create one.')}</p>
              )}
            </CollapsibleContent>
          </Collapsible>
        </Item>
      </div>

      {/* Edit payment info dialog */}
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
                      onClick={() => {
                        setPaymentInfoEditMethods(paymentInfoEditMethods.filter((_, i) => i !== idx))
                      }}
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
                  onClick={() => setPaymentInfoEditMethods([...paymentInfoEditMethods, { type: 'lightning', authority: '' }])}
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
                <ChevronDown className={`h-4 w-4 transition-transform ${paymentInfoShowFullJson ? 'rotate-180' : ''}`} />
                {t('Show full event JSON')}
              </Button>
              {paymentInfoShowFullJson && (
                <pre className="mt-2 p-3 rounded-md bg-muted text-xs overflow-auto max-h-48 break-all whitespace-pre-wrap border">
                  {JSON.stringify(
                    createPaymentInfoDraftEvent(
                      paymentInfoEditContent.trim() || '{}',
                      paymentInfoEditMethods
                        .filter((m) => m.authority.trim())
                        .map((m) => ['payto', (m.type.trim() || 'lightning').toLowerCase(), m.authority.trim()])
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

function Item({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2">{children}</div>
}
