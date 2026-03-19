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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import logger from '@/lib/logger'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { ExtendedKind } from '@/constants'
import {
  getRelaysForSpell,
  getRelaysForSpellCatalogSync,
  getSpellName,
  isSpellEvent,
  SPELL_CATALOG_SYNC_LIMIT,
  spellEventToFilter,
  spellHasExplicitRelays,
  spellIsCount
} from '@/services/spell.service'
import { TFeedSubRequest } from '@/types'
import { Check, ChevronDown, Copy, FileText, MoreVertical, Pencil, Plus, Star, Trash2, Wand2 } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools'
import { Fragment, forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CreateSpellDialog from './CreateSpellDialog'
import type { TPageRef } from '@/types'

const SpellsPage = forwardRef<TPageRef>(function SpellsPage(_, ref) {
  const { t } = useTranslation()
  const { pubkey, relayList } = useNostr()
  const [spells, setSpells] = useState<Event[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [selectedSpell, setSelectedSpell] = useState<Event | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [spellToEdit, setSpellToEdit] = useState<Event | null>(null)
  const [spellToClone, setSpellToClone] = useState<Event | null>(null)
  const [definitionSpell, setDefinitionSpell] = useState<Event | null>(null)
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])
  const [contacts, setContacts] = useState<string[]>([])
  /** True while fetching kind 777 authored by the user from write relays into IndexedDB */
  const [spellsCatalogSyncing, setSpellsCatalogSyncing] = useState(false)
  const spellCatalogCloserRef = useRef<(() => void) | null>(null)
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

  /** Re-sync catalog when inbox / outbox / mailbox entries change (not only `write`). */
  const spellCatalogRelayKey = useMemo(
    () =>
      relayList
        ? JSON.stringify({
            r: relayList.read,
            w: relayList.write,
            o: relayList.originalRelays.map((x) => [x.url, x.scope])
          })
        : '',
    [relayList]
  )

  useEffect(() => {
    loadSpells()
  }, [loadSpells])

  /** After showing the cache, pull kind 777 from merged mailbox (10002 + 10432) read/write + fast read. */
  useEffect(() => {
    if (!pubkey) {
      setSpellsCatalogSyncing(false)
      return
    }
    let cancelled = false
    spellCatalogCloserRef.current = null
    setSpellsCatalogSyncing(true)
    const urls = getRelaysForSpellCatalogSync(relayList ?? undefined)
    const filter = {
      kinds: [ExtendedKind.SPELL],
      authors: [pubkey],
      limit: SPELL_CATALOG_SYNC_LIMIT
    }
    const syncTimeout = window.setTimeout(() => {
      if (cancelled) return
      logger.warn('[SpellsPage] Spell catalog sync timed out')
      spellCatalogCloserRef.current?.()
      spellCatalogCloserRef.current = null
      setSpellsCatalogSyncing(false)
    }, 40_000)

    void (async () => {
      try {
        const { closer } = await client.subscribeTimeline(
          [{ urls, filter }],
          {
            onEvents: async (events, eosed) => {
              if (!eosed || cancelled) return
              window.clearTimeout(syncTimeout)
              for (const ev of events) {
                if (cancelled) return
                if (!verifyEvent(ev) || !isSpellEvent(ev) || ev.pubkey !== pubkey) continue
                try {
                  await indexedDb.putSpellEvent(ev)
                } catch (e) {
                  logger.warn('[SpellsPage] Failed to cache spell from relay', e)
                }
              }
              if (!cancelled) await loadSpells()
              if (!cancelled) setSpellsCatalogSyncing(false)
              closer()
              spellCatalogCloserRef.current = null
            },
            onNew: () => {}
          },
          { needSort: true }
        )
        if (cancelled) {
          closer()
          return
        }
        spellCatalogCloserRef.current = closer
      } catch (e) {
        window.clearTimeout(syncTimeout)
        logger.warn('[SpellsPage] Spell catalog subscribe failed', e)
        if (!cancelled) setSpellsCatalogSyncing(false)
      }
    })()

    return () => {
      cancelled = true
      window.clearTimeout(syncTimeout)
      spellCatalogCloserRef.current?.()
      spellCatalogCloserRef.current = null
      setSpellsCatalogSyncing(false)
    }
  }, [pubkey, spellCatalogRelayKey, loadSpells])

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
    const relayListWrite = relayList?.write ?? []
    const ctx = {
      pubkey,
      contacts
    }
    const filter = spellEventToFilter(selectedSpell, ctx)
    if (!filter) {
      setSubRequests([])
      return
    }
    const relays = getRelaysForSpell(selectedSpell, { relayListWrite })
    if (!relays.length) {
      setSubRequests([])
      return
    }
    setSubRequests([{ urls: relays, filter }])
  }, [selectedSpell, pubkey, contacts, relayList?.write])

  useEffect(() => {
    if (!selectedSpell || !spellIsCount(selectedSpell)) {
      return
    }
    let cancelled = false
    const relayListWrite = relayList?.write ?? []
    const ctx = { pubkey, contacts }
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
    const relays = getRelaysForSpell(selectedSpell, { relayListWrite }, { mergeDefaultReadRelays: false })
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
  }, [selectedSpell, pubkey, contacts, relayList?.write])

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

  const { ownSpells, followSpells, otherSpells, spellsForSelect } = useMemo(() => {
    const byName = (a: Event, b: Event) =>
      getSpellName(a).localeCompare(getSpellName(b), undefined, { sensitivity: 'base' })

    const followSet = new Set(contacts)
    const own: Event[] = []
    const follow: Event[] = []
    const other: Event[] = []

    for (const s of spells) {
      if (pubkey && s.pubkey === pubkey) own.push(s)
      else if (followSet.has(s.pubkey)) follow.push(s)
      else other.push(s)
    }

    own.sort(byName)
    follow.sort(byName)
    other.sort(byName)

    return {
      ownSpells: own,
      followSpells: follow,
      otherSpells: other,
      spellsForSelect: [...own, ...follow, ...other]
    }
  }, [spells, pubkey, contacts])

  const spellMenuLabel = useCallback(
    (spell: Event) => (favoriteIds.has(spell.id) ? `★ ${getSpellName(spell)}` : getSpellName(spell)),
    [favoriteIds]
  )

  const renderSpellMenuItem = useCallback(
    (spell: Event) => (
      <DropdownMenuItem onSelect={() => setSelectedSpell(spell)} className="gap-2">
        <span className="flex size-4 shrink-0 items-center justify-center">
          {selectedSpell?.id === spell.id ? <Check className="size-4" aria-hidden /> : null}
        </span>
        <span className="min-w-0 truncate">{spellMenuLabel(spell)}</span>
      </DropdownMenuItem>
    ),
    [selectedSpell?.id, spellMenuLabel]
  )

  const selectedSpellIsOwn = !!(pubkey && selectedSpell && selectedSpell.pubkey === pubkey)

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
              setSpellToClone(null)
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={spellsForSelect.length === 0}
                className="min-w-0 flex-1 justify-between font-normal sm:max-w-md"
                title={selectedSpell ? spellMenuLabel(selectedSpell) : undefined}
              >
                <span className="truncate">
                  {selectedSpell ? spellMenuLabel(selectedSpell) : t('Select a spell…')}
                </span>
                <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[min(24rem,70vh)] w-[var(--radix-dropdown-menu-trigger-width)] min-w-[12rem] overflow-y-auto sm:max-w-md"
            >
              <DropdownMenuItem onSelect={() => setSelectedSpell(null)} className="gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {!selectedSpell ? <Check className="size-4" aria-hidden /> : null}
                </span>
                <span className="truncate">{t('Select a spell…')}</span>
              </DropdownMenuItem>
              {(ownSpells.length > 0 || followSpells.length > 0 || otherSpells.length > 0) && (
                <DropdownMenuSeparator />
              )}
              {ownSpells.map((spell) => (
                <Fragment key={spell.id}>{renderSpellMenuItem(spell)}</Fragment>
              ))}
              {ownSpells.length > 0 && (followSpells.length > 0 || otherSpells.length > 0) && (
                <DropdownMenuSeparator />
              )}
              {followSpells.length > 0 ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="cursor-default">
                    {t('Spells from follows', { count: followSpells.length })}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    className="max-h-[50vh] min-w-[12rem] overflow-y-auto sm:min-w-[16rem]"
                    showScrollButtons
                  >
                    {followSpells.map((spell) => (
                      <Fragment key={spell.id}>{renderSpellMenuItem(spell)}</Fragment>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              {otherSpells.length > 0 && (ownSpells.length > 0 || followSpells.length > 0) ? (
                <DropdownMenuSeparator />
              ) : null}
              {otherSpells.length > 0 ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="cursor-default">
                    {t('Other spells', { count: otherSpells.length })}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    className="max-h-[50vh] min-w-[12rem] overflow-y-auto sm:min-w-[16rem]"
                    showScrollButtons
                  >
                    {otherSpells.map((spell) => (
                      <Fragment key={spell.id}>{renderSpellMenuItem(spell)}</Fragment>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              className="justify-start gap-2"
              variant="outline"
              onClick={() => {
                setSpellToEdit(null)
                setSpellToClone(null)
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
                    {selectedSpellIsOwn ? (
                      <DropdownMenuItem
                        className="gap-2"
                        onClick={() => {
                          setSpellToClone(null)
                          setSpellToEdit(selectedSpell)
                          setCreateOpen(true)
                        }}
                      >
                        <Pencil className="size-4" />
                        {t('Edit spell')}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        className="gap-2"
                        onClick={() => {
                          setSpellToEdit(null)
                          setSpellToClone(selectedSpell)
                          setCreateOpen(true)
                        }}
                      >
                        <Copy className="size-4" />
                        {t('Clone spell')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="gap-2" onClick={() => setDefinitionSpell(selectedSpell)}>
                      <FileText className="size-4" />
                      {t('View definition')}
                    </DropdownMenuItem>
                    {selectedSpellIsOwn ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="gap-2 text-destructive focus:text-destructive"
                          onClick={() => handleDeleteSpell(selectedSpell)}
                        >
                          <Trash2 className="size-4" />
                          {t('Delete')}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>

        {spellsCatalogSyncing ? (
          <p className="text-xs text-muted-foreground">{t('Loading spells from your relays…')}</p>
        ) : null}

        {spellsForSelect.length === 0 && !spellsCatalogSyncing && (
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
                      'Could not run this spell. Check that it has a valid REQ/COUNT command, or add write relays in settings.'
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
                  'Could not run this spell. Check that it has a valid REQ/COUNT command, or add write relays in settings.'
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
          if (!open) {
            setSpellToEdit(null)
            setSpellToClone(null)
          }
        }}
        spellToEdit={spellToEdit}
        spellToClone={spellToClone}
        onSaved={(ev) => {
          void loadSpells()
          if (ev && spellToEdit && selectedSpell?.id === spellToEdit.id) {
            setSelectedSpell(ev)
          }
          if (ev && spellToClone && selectedSpell?.id === spellToClone.id) {
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
