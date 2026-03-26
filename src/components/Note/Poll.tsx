import { Button } from '@/components/ui/button'
import { FAST_READ_RELAY_URLS, POLL_TYPE } from '@/constants'
import { useFetchPollResults } from '@/hooks/useFetchPollResults'
import { createPollResponseDraftEvent } from '@/lib/draft-event'
import { getPollMetadataFromEvent } from '@/lib/event-metadata'
import { buildPollResultsReadRelayUrls } from '@/lib/relay-list-builder'
import { cn, isPartiallyInViewport } from '@/lib/utils'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostrOptional } from '@/providers/nostr-context'
import pollResultsService from '@/services/poll-results.service'
import dayjs from 'dayjs'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2 } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import logger from '@/lib/logger'
import { showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'

/**
 * Persists "See results" across remounts (React Strict Mode dev double-mount, list recycle).
 * Scoped to this tab session only.
 */
const pollSessionRevealResultIds = new Set<string>()

export default function Poll({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const nostr = useNostrOptional()
  const pubkey = nostr?.pubkey ?? null
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const publish = nostr?.publish ?? (async () => { throw new Error('Not logged in') })
  const startLogin = nostr?.startLogin ?? (() => {})
  const [isVoting, setIsVoting] = useState(false)
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([])
  /** User chose to view vote breakdown without voting first (card UX). */
  const [resultsRevealed, setResultsRevealed] = useState(
    () => pollSessionRevealResultIds.has(event.id)
  )

  useEffect(() => {
    setResultsRevealed(pollSessionRevealResultIds.has(event.id))
  }, [event.id])
  const pollResults = useFetchPollResults(event.id)
  const [isLoadingResults, setIsLoadingResults] = useState(false)
  const poll = useMemo(() => getPollMetadataFromEvent(event), [event])
  const votedOptionIds = useMemo(() => {
    if (!pollResults || !pubkey) return []
    return Object.entries(pollResults.results)
      .filter(([, voters]) => voters.has(pubkey))
      .map(([optionId]) => optionId)
  }, [pollResults, pubkey])
  const isExpired = useMemo(() => poll?.endsAt && dayjs().unix() > poll.endsAt, [poll])
  const isMultipleChoice = useMemo(() => poll?.pollType === POLL_TYPE.MULTIPLE_CHOICE, [poll])
  const canVote = useMemo(() => !isExpired && !votedOptionIds.length, [isExpired, votedOptionIds])
  const showResults = useMemo(() => {
    return Boolean(isExpired) || resultsRevealed || event.pubkey === pubkey || !canVote
  }, [isExpired, resultsRevealed, event.pubkey, pubkey, canVote])
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  /** Stops viewport-triggered refetch loops when the first load fails or yields no subscriber update. */
  const pollResultsViewportFetchDoneRef = useRef(false)

  useEffect(() => {
    pollResultsViewportFetchDoneRef.current = false
  }, [event.id])

  const fetchResults = useCallback(async () => {
    const meta = getPollMetadataFromEvent(event)
    if (!meta) return undefined
    setIsLoadingResults(true)
    try {
      const relays = await buildPollResultsReadRelayUrls({
        pollEvent: event,
        pollRelayUrls: meta.relayUrls,
        viewerPubkey: pubkey,
        viewerFavoriteRelayUrls: favoriteRelays,
        blockedRelays
      })
      const optionIds = meta.options.map((o) => o.id)
      const multi = meta.pollType === POLL_TYPE.MULTIPLE_CHOICE
      return await pollResultsService.fetchResults(
        event.id,
        relays,
        optionIds,
        multi,
        meta.endsAt
      )
    } catch (error) {
      logger.error('Failed to fetch poll results', { error, eventId: event.id })
      toast.error('Failed to fetch poll results: ' + (error as Error).message)
    } finally {
      pollResultsViewportFetchDoneRef.current = true
      setIsLoadingResults(false)
    }
  }, [event, pubkey, favoriteRelays, blockedRelays])

  useEffect(() => {
    if (
      isExpired ||
      pollResults ||
      isLoadingResults ||
      !containerElement ||
      pollResultsViewportFetchDoneRef.current
    ) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            if (isPartiallyInViewport(containerElement)) {
              void fetchResults()
            }
          }, 200)
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(containerElement)

    return () => {
      observer.unobserve(containerElement)
    }
  }, [isExpired, pollResults, isLoadingResults, containerElement, fetchResults])

  useEffect(() => {
    if (!poll || !isExpired) return
    pollSessionRevealResultIds.add(event.id)
    setResultsRevealed(true)
    void fetchResults()
  }, [poll, isExpired, fetchResults, event.id])

  if (!poll) {
    return null
  }

  const handleOptionClick = (optionId: string) => {
    if (isExpired) return

    if (isMultipleChoice) {
      setSelectedOptionIds((prev) =>
        prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId]
      )
    } else {
      setSelectedOptionIds((prev) => (prev.includes(optionId) ? [] : [optionId]))
    }
  }

  const handleVote = async () => {
    if (selectedOptionIds.length === 0) return
    if (!pubkey) {
      startLogin()
      return
    }

    setIsVoting(true)
    try {
      if (!pollResults) {
        const _pollResults = await fetchResults()
        if (_pollResults && _pollResults.voters.has(pubkey)) {
          return
        }
      }

      const additionalRelayUrls = await ensurePollRelays(event.pubkey, poll)

      const draftEvent = createPollResponseDraftEvent(event, selectedOptionIds)
      const publishedEvent = await publish(draftEvent, {
        additionalRelayUrls
      })

      // Show publishing feedback
      if ((publishedEvent as any)?.relayStatuses) {
        showPublishingFeedback({
          success: true,
          relayStatuses: (publishedEvent as any).relayStatuses,
          successCount: (publishedEvent as any).relayStatuses.filter((s: any) => s.success).length,
          totalCount: (publishedEvent as any).relayStatuses.length
        }, {
          message: t('Vote published'),
          duration: 4000
        })
      } else {
        showSimplePublishSuccess(t('Vote published'))
      }

      setSelectedOptionIds([])
      pollResultsService.addPollResponse(event.id, pubkey, selectedOptionIds)
    } catch (error) {
      logger.error('Failed to vote', { error, eventId: event.id })
      toast.error('Failed to vote: ' + (error as Error).message)
    } finally {
      setIsVoting(false)
    }
  }

  return (
    <div className={className} ref={setContainerElement}>
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">
          {!isExpired && poll.pollType === POLL_TYPE.MULTIPLE_CHOICE && (
            <p>{t('Multiple choice (select one or more)')}</p>
          )}
          <p>
            {!!poll.endsAt &&
              (isExpired
                ? t('Poll has ended')
                : t('Poll ends at {{time}}', {
                    time: new Date(poll.endsAt * 1000).toLocaleString()
                  }))}
          </p>
        </div>

        {/* Results rows (read-only when ended or already voted) */}
        <div className="grid gap-2">
          {poll.options.map((option) => {
            const votes = pollResults?.results?.[option.id]?.size ?? 0
            const totalVotes = pollResults?.totalVotes ?? 0
            const percentage =
              showResults && totalVotes > 0 ? (votes / totalVotes) * 100 : showResults ? 0 : 0
            const isMax =
              pollResults && pollResults.totalVotes > 0 && showResults
                ? Object.values(pollResults.results).every((res) => res.size <= votes)
                : false

            const rowClass = cn(
              'relative w-full px-4 py-3 rounded-lg border flex items-center gap-2 overflow-hidden',
              canVote && 'transition-all',
              canVote ? 'cursor-pointer' : 'cursor-default',
              canVote &&
                (selectedOptionIds.includes(option.id)
                  ? 'border-primary bg-primary/20'
                  : 'hover:border-primary/40 hover:bg-primary/5')
            )

            const inner = (
              <>
                <div className="flex items-center gap-2 flex-1 w-0 z-10">
                  <div className={cn('line-clamp-2 text-left', isMax ? 'font-semibold' : '')}>
                    {option.label}
                  </div>
                  {votedOptionIds.includes(option.id) && (
                    <CheckCircle2 className="size-4 shrink-0" />
                  )}
                </div>
                {showResults && (
                  <div
                    className={cn(
                      'text-muted-foreground shrink-0 z-10 tabular-nums text-right',
                      isMax ? 'font-semibold text-foreground' : ''
                    )}
                  >
                    {isExpired
                      ? t('{{votes}} · {{pct}}%', {
                          votes,
                          pct: totalVotes > 0 ? percentage.toFixed(1) : '0'
                        })
                      : totalVotes > 0
                        ? `${percentage.toFixed(1)}%`
                        : '0%'}
                  </div>
                )}
                {showResults && (
                  <div
                    className={cn(
                      'absolute inset-0 rounded-r-sm transition-all duration-700 ease-out',
                      isMax ? 'bg-primary/60' : 'bg-muted/90'
                    )}
                    style={{ width: `${percentage}%` }}
                  />
                )}
              </>
            )

            return canVote ? (
              <button
                key={option.id}
                type="button"
                title={option.label}
                className={rowClass}
                onClick={(e) => {
                  e.stopPropagation()
                  handleOptionClick(option.id)
                }}
              >
                {inner}
              </button>
            ) : (
              <div key={option.id} className={cn(rowClass, 'border-border bg-card/30')} title={option.label}>
                {inner}
              </div>
            )
          })}
        </div>

        {canVote && !resultsRevealed && (
          <div className="flex justify-start pt-1">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto min-h-0 w-fit max-w-full px-0 py-1 text-xs font-normal text-muted-foreground no-underline hover:text-foreground hover:underline"
              onClick={(e) => {
                e.stopPropagation()
                pollSessionRevealResultIds.add(event.id)
                setResultsRevealed(true)
                void fetchResults()
              }}
            >
              {t('See results')}
            </Button>
          </div>
        )}

        {/* Results Summary */}
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <div>{t('{{number}} votes', { number: pollResults?.totalVotes ?? 0 })}</div>

          {isLoadingResults && t('Loading...')}
          {!isLoadingResults && showResults && (
            <div
              className="hover:underline cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                fetchResults()
              }}
            >
              {!pollResults ? t('Load results') : t('Refresh results')}
            </div>
          )}
        </div>

        {/* Vote Button */}
        {canVote && !!selectedOptionIds.length && (
          <Button
            onClick={(e) => {
              e.stopPropagation()
              if (selectedOptionIds.length === 0) return
              handleVote()
            }}
            disabled={!selectedOptionIds.length || isVoting}
            className="w-full"
          >
            {isVoting && <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />}
            {t('Vote')}
          </Button>
        )}
      </div>
    </div>
  )
}

async function ensurePollRelays(_creator: string, poll: { relayUrls: string[] }) {
  const relays = poll.relayUrls.slice(0, 4)
  // Privacy: Use defaults instead of fetching creator's relays
  if (!relays.length) {
    relays.push(...FAST_READ_RELAY_URLS.slice(0, 4))
  }
  return relays
}
