import NoteList from '@/components/NoteList'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import {
  getRelaysForSpell,
  getSpellName,
  spellEventToFilter,
  spellIsCount
} from '@/services/spell.service'
import { TFeedSubRequest } from '@/types'
import { FileText, MoreVertical, Plus, Star, Trash2, Wand2 } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreateSpellDialog from './CreateSpellDialog'
import type { TPageRef } from '@/types'

/** Sentinel value for Radix Select when no spell is selected */
const SPELL_SELECT_NONE = '__spell_none__'

const SpellsPage = forwardRef<TPageRef>(function SpellsPage(_, ref) {
  const { t } = useTranslation()
  const { pubkey, relayList } = useNostr()
  const [spells, setSpells] = useState<Event[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [selectedSpell, setSelectedSpell] = useState<Event | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [definitionSpell, setDefinitionSpell] = useState<Event | null>(null)
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])
  const [contacts, setContacts] = useState<string[]>([])

  const loadSpells = useCallback(async () => {
    const [events, ids] = await Promise.all([
      indexedDb.getSpellEvents(),
      indexedDb.getSpellFavoriteIds()
    ])
    setSpells(events)
    setFavoriteIds(new Set(ids))
  }, [])

  useEffect(() => {
    loadSpells()
  }, [loadSpells])

  useEffect(() => {
    if (!pubkey) {
      setContacts([])
      return
    }
    client.fetchFollowings(pubkey).then(setContacts).catch(() => setContacts([]))
  }, [pubkey])

  useEffect(() => {
    if (!selectedSpell) {
      setSubRequests([])
      return
    }
    if (spellIsCount(selectedSpell)) {
      setSubRequests([])
      return
    }
    const defaultRelays = [...new Set([...FAST_READ_RELAY_URLS, ...SEARCHABLE_RELAY_URLS])]
    const relayListRead = relayList?.read?.length ? relayList.read : defaultRelays
    const ctx = {
      pubkey,
      contacts,
      relayListRead
    }
    const filter = spellEventToFilter(selectedSpell, ctx)
    if (!filter) {
      setSubRequests([])
      return
    }
    const relays = getRelaysForSpell(selectedSpell, { relayListRead })
    if (!relays.length) {
      setSubRequests([])
      return
    }
    setSubRequests([{ urls: relays, filter }])
  }, [selectedSpell, pubkey, contacts, relayList?.read])

  const toggleFavorite = useCallback(async (spellId: string) => {
    const ids = await indexedDb.getSpellFavoriteIds()
    const set = new Set(ids)
    if (set.has(spellId)) set.delete(spellId)
    else set.add(spellId)
    await indexedDb.setSpellFavoriteIds([...set])
    setFavoriteIds(set)
  }, [])

  const handleDeleteSpell = useCallback(
    async (spell: Event) => {
      await indexedDb.deleteSpellEvent(spell.id)
      const ids = await indexedDb.getSpellFavoriteIds()
      await indexedDb.setSpellFavoriteIds(ids.filter((id) => id !== spell.id))
      if (selectedSpell?.id === spell.id) setSelectedSpell(null)
      loadSpells()
    },
    [loadSpells, selectedSpell?.id]
  )

  const orderedSpells = [...spells].sort((a, b) => {
    const aFav = favoriteIds.has(a.id)
    const bFav = favoriteIds.has(b.id)
    if (aFav && !bFav) return -1
    if (!aFav && bFav) return 1
    return (b.created_at ?? 0) - (a.created_at ?? 0)
  })

  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="spells"
      titlebar={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="font-semibold">{t('Spells')}</div>
          <Button
            variant="ghost"
            size="titlebar-icon"
            onClick={() => setCreateOpen(true)}
            title={t('Create a Spell')}
          >
            <Plus className="size-5" />
          </Button>
        </div>
      }
      displayScrollToTopButton
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        {/* Spell picker + actions above the feed */}
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Select
            value={selectedSpell?.id ?? SPELL_SELECT_NONE}
            onValueChange={(v) => {
              if (v === SPELL_SELECT_NONE) setSelectedSpell(null)
              else setSelectedSpell(orderedSpells.find((s) => s.id === v) ?? null)
            }}
            disabled={orderedSpells.length === 0}
          >
            <SelectTrigger className="min-w-0 flex-1 sm:max-w-md">
              <SelectValue placeholder={t('Select a spell…')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SPELL_SELECT_NONE}>{t('Select a spell…')}</SelectItem>
              {orderedSpells.map((spell) => (
                <SelectItem key={spell.id} value={spell.id}>
                  {favoriteIds.has(spell.id) ? `★ ${getSpellName(spell)}` : getSpellName(spell)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              className="justify-start gap-2"
              variant="outline"
              onClick={() => setCreateOpen(true)}
            >
              <Wand2 className="size-4" />
              {t('Create a Spell')}
            </Button>
            {selectedSpell && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  title={
                    favoriteIds.has(selectedSpell.id)
                      ? t('Remove from favorites')
                      : t('Add to favorites')
                  }
                  onClick={() => toggleFavorite(selectedSpell.id)}
                >
                  <Star
                    className={`size-4 ${favoriteIds.has(selectedSpell.id) ? 'fill-amber-400 text-amber-500' : ''}`}
                  />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="shrink-0" title={t('More options')}>
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setDefinitionSpell(selectedSpell)}>
                      <FileText className="size-4" />
                      {t('View definition')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => handleDeleteSpell(selectedSpell)}
                    >
                      <Trash2 className="size-4" />
                      {t('Delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>

        {orderedSpells.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('No spells yet. Create one with the button above.')}</p>
        )}

        {/* Feed */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedSpell ? (
            subRequests.length > 0 ? (
              <NoteList
                subRequests={subRequests}
                showKinds={(() => {
                  const kinds = selectedSpell.tags
                    .filter((tag) => tag[0] === 'k')
                    .map((tag) => parseInt(tag[1], 10))
                    .filter((n) => !Number.isNaN(n))
                  // `[] || [1]` is wrong ([] is truthy); default to kind 1 for notes
                  return kinds.length ? kinds : [1]
                })()}
                useFilterAsIs
              />
            ) : spellIsCount(selectedSpell) ? (
              <div className="py-8 text-center text-muted-foreground">
                {t('COUNT spells show a number, not a feed.')}
              </div>
            ) : !pubkey &&
              selectedSpell.tags.some(
                (tag) => tag[0] === 'authors' && (tag.includes('$me') || tag.includes('$contacts'))
              ) ? (
              <div className="py-8 text-center text-muted-foreground">
                {t('Log in to run this spell (it uses $me or $contacts).')}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                {t(
                  'Could not run this spell. Check that it has a valid REQ/COUNT command, or add read relays in settings.'
                )}
              </div>
            )
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              {t('Select a spell to view its feed.')}
            </div>
          )}
        </div>
      </div>

      <CreateSpellDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={loadSpells} />

      <Dialog open={!!definitionSpell} onOpenChange={(open) => !open && setDefinitionSpell(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {definitionSpell ? getSpellName(definitionSpell) : t('Spell definition')}
            </DialogTitle>
          </DialogHeader>
          {definitionSpell && (
            <div className="space-y-4 text-sm">
              {definitionSpell.content?.trim() && (
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">{t('Description')}</div>
                  <p className="whitespace-pre-wrap break-words">{definitionSpell.content.trim()}</p>
                </div>
              )}
              <div>
                <div className="mb-2 font-medium text-muted-foreground">{t('Tags')}</div>
                <dl className="space-y-1.5 font-mono text-xs">
                  {definitionSpell.tags.map((tag, i) => (
                    <div key={i} className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <dt className="shrink-0 text-muted-foreground">{tag[0]}:</dt>
                      <dd className="min-w-0 break-all">
                        {tag.length > 1 ? tag.slice(1).join(', ') : '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="overflow-wrap-anywhere break-words text-xs text-muted-foreground">
                <span className="font-medium">id:</span> <span className="break-all">{definitionSpell.id}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PrimaryPageLayout>
  )
})

export default SpellsPage
