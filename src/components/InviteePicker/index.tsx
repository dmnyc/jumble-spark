import { Input } from '@/components/ui/input'
import { useSearchProfiles } from '@/hooks'
import { inviteInputToHexPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SimpleUserAvatar } from '../UserAvatar'
import { SimpleUsername } from '../Username'
import Nip05 from '../Nip05'

const SEARCH_DEBOUNCE_MS = 300
const SEARCH_LIMIT = 10

export function InviteePicker({
  value,
  onChange,
  placeholder,
  className,
  labelId,
  max
}: {
  value: string[]
  onChange: (pubkeys: string[]) => void
  placeholder?: string
  className?: string
  labelId?: string
  /** Max number of invitees (e.g. MAX_CALENDAR_INVITEES). When reached, adding is disabled. */
  max?: number
}) {
  const { t } = useTranslation()
  const { pubkey: myPubkey } = useNostr()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [search])

  const { profiles, isFetching } = useSearchProfiles(debouncedSearch, SEARCH_LIMIT)
  const selectedSet = new Set(value)
  const atLimit = max != null && value.length >= max
  const filteredProfiles = profiles.filter((p) => !selectedSet.has(p.pubkey) && p.pubkey !== myPubkey)

  const addInvitee = useCallback(
    (pubkey: string) => {
      if (pubkey === myPubkey || selectedSet.has(pubkey)) return
      if (max != null && value.length >= max) return
      onChange([...value, pubkey])
      setSearch('')
    },
    [value, onChange, myPubkey, selectedSet, max]
  )

  const removeInvitee = useCallback(
    (pubkey: string) => {
      onChange(value.filter((p) => p !== pubkey))
    },
    [value, onChange]
  )

  return (
    <div className={cn('space-y-2', className)}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((pubkey) => (
            <span
              key={pubkey}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-sm"
            >
              <SimpleUserAvatar userId={pubkey} className="size-5 shrink-0" />
              <SimpleUsername userId={pubkey} className="max-w-[120px] truncate" />
              <button
                type="button"
                onClick={() => removeInvitee(pubkey)}
                className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                aria-label={t('Remove')}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          id={labelId}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const pk = inviteInputToHexPubkey(search)
            if (pk) addInvitee(pk)
          }}
          placeholder={placeholder ?? t('Search by name or npub…')}
          className="mt-1"
          autoComplete="off"
        />
        {search.trim() && !atLimit && (
          <div
            className={cn(
              'absolute left-0 right-0 top-full z-10 mt-1 max-h-60 overflow-auto rounded-md border bg-popover shadow-md'
            )}
          >
            {isFetching && filteredProfiles.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">{t('Searching…')}</div>
            ) : filteredProfiles.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">{t('No users found')}</div>
            ) : (
              <ul className="py-1">
                {filteredProfiles.map((profile) => (
                  <li key={profile.pubkey}>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-2 p-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                      onClick={() => addInvitee(profile.pubkey)}
                    >
                      <SimpleUserAvatar userId={profile.pubkey} className="size-8 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <SimpleUsername userId={profile.pubkey} className="font-medium truncate" />
                        <Nip05 pubkey={profile.pubkey} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      {atLimit && (
        <p className="text-xs text-muted-foreground">
          {t('Maximum {{max}} invitees', { max: max ?? 0 })}
        </p>
      )}
      </div>
    </div>
  )
}
