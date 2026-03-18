import NoteList from '@/components/NoteList'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
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
import { ChevronLeft, Plus, Wand2 } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreateSpellDialog from './CreateSpellDialog'
import type { TPageRef } from '@/types'

const SpellsPage = forwardRef<TPageRef>(function SpellsPage(_, ref) {
  const { t } = useTranslation()
  const { pubkey, relayList } = useNostr()
  const { isSmallScreen } = useScreenSize()
  const [spells, setSpells] = useState<Event[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [selectedSpell, setSelectedSpell] = useState<Event | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
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
        isSmallScreen ? (
          <div className="flex items-center justify-between w-full gap-2">
            {selectedSpell ? (
              <Button
                variant="ghost"
                size="titlebar-icon"
                onClick={() => setSelectedSpell(null)}
                title={t('Back to spell list')}
              >
                <ChevronLeft className="size-5" />
              </Button>
            ) : (
              <div className="w-10 shrink-0" />
            )}
            <div className="font-semibold flex-1 text-center min-w-0 truncate">
              {selectedSpell ? getSpellName(selectedSpell) : t('Spells')}
            </div>
            <Button
              variant="ghost"
              size="titlebar-icon"
              onClick={() => setCreateOpen(true)}
              title={t('Create a Spell')}
            >
              <Plus className="size-5" />
            </Button>
          </div>
        ) : (
          <div className="font-semibold">{t('Spells')}</div>
        )
      }
      displayScrollToTopButton
    >
      <div className="flex flex-col md:flex-row min-h-0 flex-1 gap-4 p-4">
        {/* Left (desktop) / Top (mobile) pane: spell list */}
        <div className={`flex flex-col gap-2 shrink-0 ${isSmallScreen ? 'order-1 border-b border-border pb-4' : 'w-64 border-r border-border pr-4'}`}>
          <Button
            className="w-full justify-start gap-2"
            variant="outline"
            onClick={() => setCreateOpen(true)}
          >
            <Wand2 className="size-4" />
            {t('Create a Spell')}
          </Button>
          <div className="text-sm text-muted-foreground mt-1">
            {t('Select a spell to run its filter and see the feed.')}
          </div>
          <ul className="space-y-1 overflow-y-auto min-h-0">
            {orderedSpells.length === 0 && (
              <li className="text-sm text-muted-foreground py-2">{t('No spells yet. Create one above.')}</li>
            )}
            {orderedSpells.map((spell) => (
              <li key={spell.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className={`flex-1 text-left text-sm px-2 py-1.5 rounded truncate ${selectedSpell?.id === spell.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}
                  onClick={() => setSelectedSpell(spell)}
                >
                  {getSpellName(spell)}
                </button>
                <button
                  type="button"
                  className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
                  onClick={() => toggleFavorite(spell.id)}
                  title={favoriteIds.has(spell.id) ? t('Remove from favorites') : t('Add to favorites')}
                >
                  {favoriteIds.has(spell.id) ? '★' : '☆'}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Right (desktop) / Bottom (mobile) pane: feed */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedSpell ? (
            subRequests.length > 0 ? (
              <NoteList
                subRequests={subRequests}
                showKinds={selectedSpell.tags.filter((t) => t[0] === 'k').map((t) => parseInt(t[1], 10)).filter((n) => !Number.isNaN(n)) || [1]}
                useFilterAsIs
              />
            ) : spellIsCount(selectedSpell) ? (
              <div className="text-muted-foreground py-8 text-center">{t('COUNT spells show a number, not a feed.')}</div>
            ) : !pubkey && (selectedSpell.tags.some((t) => t[0] === 'authors' && (t.includes('$me') || t.includes('$contacts')))) ? (
              <div className="text-muted-foreground py-8 text-center">{t('Log in to run this spell (it uses $me or $contacts).')}</div>
            ) : (
              <div className="text-muted-foreground py-8 text-center">
                {t('Could not run this spell. Check that it has a valid REQ/COUNT command, or add read relays in settings.')}
              </div>
            )
          ) : (
            <div className="text-muted-foreground py-8 text-center">{t('Select a spell from the list to view its feed.')}</div>
          )}
        </div>
      </div>

      <CreateSpellDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={loadSpells}
      />
    </PrimaryPageLayout>
  )
})

export default SpellsPage
