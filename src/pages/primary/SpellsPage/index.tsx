import NoteList from '@/components/NoteList'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
  DropdownMenuSeparator,
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
  spellHasExplicitRelays,
  spellIsCount
} from '@/services/spell.service'
import { TFeedSubRequest } from '@/types'
import { FileText, MoreVertical, Pencil, Plus, Star, Trash2, Wand2 } from 'lucide-react'
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
  const [spellToEdit, setSpellToEdit] = useState<Event | null>(null)
  const [definitionSpell, setDefinitionSpell] = useState<Event | null>(null)
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])
  const [contacts, setContacts] = useState<string[]>([])
  /** COUNT spells: per-relay breakdown + distinct total */
  const [spellCount, setSpellCount] = useState<{
    loading: boolean
    rows: { url: string; count: number | null; error?: string }[]
    totalDistinct: number | null
    error: 'none' | 'login' | 'invalid' | 'failed'
    mayHitLimit: boolean
    usedExplicitRelays: boolean
  }>({
    loading: false,
    rows: [],
    totalDistinct: null,
    error: 'none',
    mayHitLimit: false,
    usedExplicitRelays: false
  })

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
      setSpellCount({
        loading: false,
        rows: [],
        totalDistinct: null,
        error: 'none',
        mayHitLimit: false,
        usedExplicitRelays: false
      })
      return
    }
    if (spellIsCount(selectedSpell)) {
      setSubRequests([])
      return
    }
    setSpellCount({
      loading: false,
      rows: [],
      totalDistinct: null,
      error: 'none',
      mayHitLimit: false,
      usedExplicitRelays: false
    })
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

  useEffect(() => {
    if (!selectedSpell || !spellIsCount(selectedSpell)) {
      return
    }
    let cancelled = false
    const defaultRelays = [...new Set([...FAST_READ_RELAY_URLS, ...SEARCHABLE_RELAY_URLS])]
    const relayListRead = relayList?.read?.length ? relayList.read : defaultRelays
    const ctx = { pubkey, contacts, relayListRead }
    const usedExplicitRelays = spellHasExplicitRelays(selectedSpell)

    const needsLogin =
      !pubkey &&
      selectedSpell.tags.some(
        (tag) => tag[0] === 'authors' && (tag.includes('$me') || tag.includes('$contacts'))
      )
    if (needsLogin) {
      setSpellCount({
        loading: false,
        rows: [],
        totalDistinct: null,
        error: 'login',
        mayHitLimit: false,
        usedExplicitRelays
      })
      return
    }

    const filter = spellEventToFilter(selectedSpell, ctx)
    if (!filter) {
      setSpellCount({
        loading: false,
        rows: [],
        totalDistinct: null,
        error: 'invalid',
        mayHitLimit: false,
        usedExplicitRelays
      })
      return
    }
    const relays = getRelaysForSpell(selectedSpell, { relayListRead }, { mergeDefaultReadRelays: false })
    if (!relays.length) {
      setSpellCount({
        loading: false,
        rows: [],
        totalDistinct: null,
        error: 'failed',
        mayHitLimit: false,
        usedExplicitRelays
      })
      return
    }

    setSpellCount({
      loading: true,
      rows: [],
      totalDistinct: null,
      error: 'none',
      mayHitLimit: false,
      usedExplicitRelays
    })
    ;(async () => {
      const rows: { url: string; count: number | null; error?: string }[] = []
      const allIds = new Set<string>()
      try {
        for (const url of relays) {
          if (cancelled) return
          const { events, connectionError } = await client.fetchEventsFromSingleRelay(url, filter, {
            globalTimeout: 28_000
          })
          if (cancelled) return
          if (connectionError) {
            rows.push({ url, count: null, error: connectionError })
          } else {
            const c = new Set(events.map((e) => e.id)).size
            rows.push({ url, count: c })
            events.forEach((e) => allIds.add(e.id))
          }
        }
        if (cancelled) return
        const lim = filter.limit
        const totalDistinct = allIds.size
        const mayHitLimit = typeof lim === 'number' && lim > 0 && totalDistinct >= lim
        setSpellCount({
          loading: false,
          rows,
          totalDistinct,
          error: 'none',
          mayHitLimit,
          usedExplicitRelays
        })
      } catch {
        if (!cancelled) {
          setSpellCount({
            loading: false,
            rows,
            totalDistinct: null,
            error: 'failed',
            mayHitLimit: false,
            usedExplicitRelays
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
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
            onClick={() => {
              setSpellToEdit(null)
              setCreateOpen(true)
            }}
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
              onClick={() => {
                setSpellToEdit(null)
                setCreateOpen(true)
              }}
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
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => {
                        setSpellToEdit(selectedSpell)
                        setCreateOpen(true)
                      }}
                    >
                      <Pencil className="size-4" />
                      {t('Edit spell')}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2" onClick={() => setDefinitionSpell(selectedSpell)}>
                      <FileText className="size-4" />
                      {t('View definition')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 text-destructive focus:text-destructive"
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
            spellIsCount(selectedSpell) ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 px-4">
                {spellCount.error === 'login' ? (
                  <p className="text-center text-muted-foreground">
                    {t('Log in to run this spell (it uses $me or $contacts).')}
                  </p>
                ) : spellCount.error === 'invalid' ? (
                  <p className="text-center text-muted-foreground">
                    {t(
                      'Could not run this spell. Check that it has a valid REQ/COUNT command, or add read relays in settings.'
                    )}
                  </p>
                ) : spellCount.error === 'failed' ? (
                  <p className="text-center text-muted-foreground">
                    {t('Spell count failed. Check relays or try again.')}
                  </p>
                ) : spellCount.loading ? (
                  <div className="flex w-full max-w-md flex-col items-center gap-3">
                    <Skeleton className="h-12 w-24" />
                    <Skeleton className="h-32 w-full max-w-lg" />
                    <p className="text-sm text-muted-foreground">{t('Counting matching events…')}</p>
                  </div>
                ) : (
                  <>
                    <div className="text-5xl font-semibold tabular-nums tracking-tight text-foreground">
                      {spellCount.totalDistinct ?? '—'}
                    </div>
                    <p className="max-w-md text-center text-sm text-muted-foreground">
                      {t('COUNT spell total distinct explanation')}
                    </p>
                    <div className="w-full max-w-3xl overflow-x-auto rounded-md border border-border">
                      <table className="w-full min-w-[20rem] border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                            <th className="px-3 py-2 font-medium">{t('Relay URL')}</th>
                            <th className="w-28 px-3 py-2 font-medium">{t('Count')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {spellCount.rows.map((r) => (
                            <tr key={r.url} className="border-b border-border/60 last:border-0">
                              <td className="break-all px-3 py-2 align-top font-mono text-xs">{r.url}</td>
                              <td className="px-3 py-2 align-top tabular-nums">
                                {r.error ? (
                                  <span className="text-destructive">{r.error}</span>
                                ) : (
                                  (r.count ?? '—')
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {spellCount.usedExplicitRelays &&
                    spellCount.rows.some((r) => r.error) &&
                    !spellCount.loading ? (
                      <div className="flex max-w-md flex-col items-center gap-2 text-center">
                        <p className="text-sm text-muted-foreground">
                          {t('COUNT spell relay errors hint')}
                        </p>
                        <Button
                          variant="outline"
                          className="gap-2"
                          onClick={() => {
                            setSpellToEdit(selectedSpell)
                            setCreateOpen(true)
                          }}
                        >
                          <Wand2 className="size-4" />
                          {t('Edit spell relays')}
                        </Button>
                      </div>
                    ) : null}
                    {spellCount.mayHitLimit ? (
                      <p className="max-w-md text-center text-xs text-amber-600 dark:text-amber-500">
                        {t('COUNT spell may be capped by limit')}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : subRequests.length > 0 ? (
              <NoteList
                subRequests={subRequests}
                showKinds={(() => {
                  const kinds = selectedSpell.tags
                    .filter((tag) => tag[0] === 'k')
                    .map((tag) => parseInt(tag[1], 10))
                    .filter((n) => !Number.isNaN(n))
                  return kinds.length ? kinds : [1]
                })()}
                useFilterAsIs
              />
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

      <CreateSpellDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setSpellToEdit(null)
        }}
        spellToEdit={spellToEdit}
        onSaved={(ev) => {
          void loadSpells()
          if (ev && spellToEdit && selectedSpell?.id === spellToEdit.id) {
            setSelectedSpell(ev)
          }
        }}
      />

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
