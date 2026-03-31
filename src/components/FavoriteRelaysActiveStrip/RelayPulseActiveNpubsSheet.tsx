import UserAvatar from '@/components/UserAvatar'
import ProfileAbout from '@/components/ProfileAbout'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { getProfileFromEvent } from '@/lib/event-metadata'
import { cn } from '@/lib/utils'
import { toProfile } from '@/lib/link'
import {
  collectAggregatedNip05sFromKind0
} from '@/lib/relay-pulse-nip05'
import { useMuteList } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { useFavoriteRelaysActivity } from '@/providers/favorite-relays-activity-context'
import { SecondaryPageLink } from '@/PageManager'
import type { Event } from 'nostr-tools'
import { Users } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

function CompactProfileCard({ event }: { event: Event }) {
  const profile = getProfileFromEvent(event)
  const nip05s = collectAggregatedNip05sFromKind0(event)
  const { setActiveNpubsDrawerOpen } = useFavoriteRelaysActivity()
  const profileUrl = toProfile(event.pubkey)
  const closeDrawer = () => setActiveNpubsDrawerOpen(false)

  return (
    <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
      <div className="flex gap-3">
        <UserAvatar userId={event.pubkey} size="semiBig" />
        <div className="min-w-0 flex-1">
          <SecondaryPageLink
            to={profileUrl}
            className="font-semibold text-foreground hover:underline"
            onClick={closeDrawer}
          >
            {profile.username}
          </SecondaryPageLink>
          <ProfileAbout
            about={profile.about}
            className="mt-1 line-clamp-4 text-xs leading-snug text-muted-foreground break-words"
          />
          {nip05s.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs">
              {nip05s.map((id) => (
                <li key={id} className="truncate font-mono">
                  <SecondaryPageLink
                    to={profileUrl}
                    className="text-primary hover:underline"
                    onClick={closeDrawer}
                  >
                    {id}
                  </SecondaryPageLink>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function RelayPulseActiveNpubsOpenButton({
  className,
  size = 'sm',
  variant = 'outline'
}: {
  className?: string
  size?: 'sm' | 'icon'
  variant?: 'outline' | 'ghost'
}) {
  const { t } = useTranslation()
  const { setActiveNpubsDrawerOpen, totalCount } = useFavoriteRelaysActivity()

  if (totalCount === 0) return null

  const countLabel = (
    <span className="tabular-nums font-medium">
      {totalCount > 99 ? '99+' : totalCount}
    </span>
  )

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(className, 'relative')}
      aria-label={t('Relay pulse active npubs')}
      title={t('Relay pulse active npubs')}
      onClick={() => setActiveNpubsDrawerOpen(true)}
    >
      <Users className={size === 'icon' ? 'size-4' : 'size-3.5 shrink-0'} />
      {size === 'icon' ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] font-medium text-primary-foreground">
          {countLabel}
        </span>
      ) : (
        <>
          <span className="ml-1.5 text-xs font-medium">{countLabel}</span>
          <span className="ml-1 text-xs text-muted-foreground">
            {t('Relay pulse active npubs')}
          </span>
        </>
      )}
    </Button>
  )
}

/** Mounted once inside {@link FavoriteRelaysActivityProvider}. */
export function RelayPulseActiveNpubsSheet() {
  const { t } = useTranslation()
  const { mutePubkeySet } = useMuteList()
  const {
    activeNpubsDrawerOpen,
    setActiveNpubsDrawerOpen,
    followPubkeys,
    otherPubkeys,
    profileKind0ByPubkey,
    profilesLoading
  } = useFavoriteRelaysActivity()

  const followWithProfile = useMemo(
    () =>
      followPubkeys.filter(
        (pk) => profileKind0ByPubkey[pk] && !muteSetHas(mutePubkeySet, pk)
      ),
    [followPubkeys, profileKind0ByPubkey, mutePubkeySet]
  )
  const othersWithProfile = useMemo(
    () =>
      otherPubkeys.filter(
        (pk) => profileKind0ByPubkey[pk] && !muteSetHas(mutePubkeySet, pk)
      ),
    [otherPubkeys, profileKind0ByPubkey, mutePubkeySet]
  )

  return (
    <Sheet open={activeNpubsDrawerOpen} onOpenChange={setActiveNpubsDrawerOpen}>
      <SheetContent
        side="right"
        className="flex h-full max-h-[100dvh] w-full flex-col overflow-hidden sm:max-w-md"
      >
        <SheetHeader className="shrink-0 text-left">
          <SheetTitle>{t('Relay pulse active npubs')}</SheetTitle>
          <SheetDescription>{t('Relay pulse active npubs hint')}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-3">
          {profilesLoading ? (
            <p className="text-sm text-muted-foreground">{t('Loading...')}</p>
          ) : null}
          <div className="space-y-6 pb-6">
            {followWithProfile.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  {t('Relay pulse drawer following')}
                </h3>
                <div className="space-y-2">
                  {followWithProfile.map((pk) => {
                    const ev = profileKind0ByPubkey[pk]
                    return ev ? <CompactProfileCard key={pk} event={ev} /> : null
                  })}
                </div>
              </section>
            ) : null}
            {othersWithProfile.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  {t('Relay pulse drawer others')}
                </h3>
                <div className="space-y-2">
                  {othersWithProfile.map((pk) => {
                    const ev = profileKind0ByPubkey[pk]
                    return ev ? <CompactProfileCard key={pk} event={ev} /> : null
                  })}
                </div>
              </section>
            ) : null}
            {!profilesLoading &&
            followWithProfile.length === 0 &&
            othersWithProfile.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('Relay pulse drawer no profiles')}</p>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
