import { useSecondaryPage } from '@/PageManager'
import { Button } from '@/components/ui/button'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious
} from '@/components/ui/carousel'
import { FAST_READ_RELAY_URLS, ExtendedKind } from '@/constants'
import { compareEvents } from '@/lib/event'
import { getStarsFromRelayReviewEvent } from '@/lib/event-metadata'
import { toRelayReviews } from '@/lib/link'
import {
  relayReviewDTagsForRelayUrl,
  relayReviewEventTargetsRelay,
  relayReviewsFeedSnapshotKey
} from '@/lib/relay-review-feed'
import { normalizeUrl } from '@/lib/url'
import { cn, isTouchDevice } from '@/lib/utils'
import { useMuteList } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/contexts/user-trust-context'
import { queryService } from '@/services/client.service'
import { getSessionFeedSnapshot } from '@/services/session-feed-snapshot.service'
import { WheelGesturesPlugin } from 'embla-carousel-wheel-gestures'
import type { NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Stars from '../Stars'
import RelayReviewCard from './RelayReviewCard'
import ReviewEditor from './ReviewEditor'

export default function RelayReviewsPreview({ relayUrl }: { relayUrl: string }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { pubkey, checkLogin } = useNostr()
  const { hideUntrustedNotes, isUserTrusted } = useUserTrust()
  const { mutePubkeySet } = useMuteList()
  const [showEditor, setShowEditor] = useState(false)
  const [myReview, setMyReview] = useState<NostrEvent | null>(null)
  const [reviews, setReviews] = useState<NostrEvent[]>([])
  const [initialized, setInitialized] = useState(false)
  const { stars, count } = useMemo(() => {
    let totalStars = 0
    let totalCount = 0
    ;[myReview, ...reviews].forEach((evt) => {
      if (!evt) return
      const stars = getStarsFromRelayReviewEvent(evt)
      if (stars) {
        totalStars += stars
        totalCount += 1
      }
    })
    return {
      stars: totalCount > 0 ? +(totalStars / totalCount).toFixed(1) : 0,
      count: totalCount
    }
  }, [myReview, reviews])

  const ingestReviewEvent = useCallback(
    (evt: NostrEvent) => {
      if (muteSetHas(mutePubkeySet, evt.pubkey)) return
      if (hideUntrustedNotes && !isUserTrusted(evt.pubkey)) return
      const stars = getStarsFromRelayReviewEvent(evt)
      if (!stars) return

      if (pubkey && evt.pubkey === pubkey) {
        setMyReview((prev) => (!prev || evt.created_at > prev.created_at ? evt : prev))
        return
      }

      setReviews((prev) => {
        const existing = prev.find((e) => e.pubkey === evt.pubkey)
        if (existing && existing.created_at >= evt.created_at) return prev
        const filtered = prev.filter((e) => e.pubkey !== evt.pubkey)
        return [...filtered, evt].sort((a, b) => compareEvents(b, a))
      })
    },
    [pubkey, mutePubkeySet, hideUntrustedNotes, isUserTrusted]
  )

  useEffect(() => {
    let cancelled = false
    setMyReview(null)
    setReviews([])
    setInitialized(false)

    const normalizedTarget = normalizeUrl(relayUrl) || relayUrl
    const dTags = relayReviewDTagsForRelayUrl(relayUrl)
    const snapKey = relayReviewsFeedSnapshotKey(normalizedTarget)
    const fromSession = getSessionFeedSnapshot(snapKey)
    if (fromSession?.length) {
      let seedMy: NostrEvent | null = null
      const seedByPubkey = new Map<string, NostrEvent>()
      for (const evt of fromSession) {
        if (evt.kind !== ExtendedKind.RELAY_REVIEW || !relayReviewEventTargetsRelay(evt, relayUrl))
          continue
        if (muteSetHas(mutePubkeySet, evt.pubkey)) continue
        if (hideUntrustedNotes && !isUserTrusted(evt.pubkey)) continue
        const st = getStarsFromRelayReviewEvent(evt)
        if (!st) continue
        if (pubkey && evt.pubkey === pubkey) {
          if (!seedMy || evt.created_at > seedMy.created_at) seedMy = evt
        } else {
          const ex = seedByPubkey.get(evt.pubkey)
          if (!ex || evt.created_at > ex.created_at) seedByPubkey.set(evt.pubkey, evt)
        }
      }
      setMyReview(seedMy)
      setReviews([...seedByPubkey.values()].sort((a, b) => compareEvents(b, a)))
    }

    const uniqueUrls = [
      ...new Set([normalizedTarget, ...FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u)])
    ]

    const filter = {
      kinds: [ExtendedKind.RELAY_REVIEW],
      '#d': dTags.length > 0 ? dTags : [relayUrl],
      limit: 100
    }

    let dispose: (() => void) | undefined
    let closed = false
    const finish = () => {
      if (closed) return
      closed = true
      if (!cancelled) setInitialized(true)
      dispose?.()
    }

    const sub = queryService.subscribe(uniqueUrls, filter, {
      onevent: (evt) => {
        if (cancelled || evt.kind !== ExtendedKind.RELAY_REVIEW) return
        ingestReviewEvent(evt)
      },
      oneose: () => {
        if (cancelled) return
        finish()
      }
    })
    dispose = sub.close

    const safety = window.setTimeout(() => {
      if (cancelled) return
      finish()
    }, 12_000)

    return () => {
      cancelled = true
      window.clearTimeout(safety)
      finish()
    }
  }, [relayUrl, ingestReviewEvent])

  const handleReviewed = (evt: NostrEvent) => {
    setMyReview(evt)
    setShowEditor(false)
  }

  return (
    <div className="space-y-4">
      <div className="px-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold">{stars}</div>
            <Stars stars={stars} />
          </div>
          <div
            className={cn(
              'text-sm text-muted-foreground',
              count > 0 && 'underline cursor-pointer hover:text-foreground'
            )}
            onClick={() => {
              if (count > 0) {
                push(toRelayReviews(relayUrl))
              }
            }}
          >
            {t('{{count}} reviews', { count })}
          </div>
        </div>
        {!showEditor && !myReview && (
          <Button variant="outline" onClick={() => checkLogin(() => setShowEditor(true))}>
            {t('Write a review')}
          </Button>
        )}
      </div>

      {showEditor && <ReviewEditor relayUrl={relayUrl} onReviewed={handleReviewed} />}

      {myReview || reviews.length > 0 ? (
        <ReviewCarousel relayUrl={relayUrl} myReview={myReview} reviews={reviews} />
      ) : !showEditor ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground p-4">
          {initialized ? t('No reviews yet. Be the first to write one!') : t('Loading...')}
        </div>
      ) : null}
    </div>
  )
}

function ReviewCarousel({
  relayUrl,
  myReview,
  reviews
}: {
  relayUrl: string
  myReview: NostrEvent | null
  reviews: NostrEvent[]
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const showPreviousAndNext = useMemo(() => !isTouchDevice(), [])

  return (
    <Carousel
      opts={{
        skipSnaps: true
      }}
      plugins={[WheelGesturesPlugin()]}
    >
      <CarouselContent className="ml-4 mr-2">
        {myReview && (
          <Item key={myReview.id}>
            <RelayReviewCard event={myReview} className="border-primary/60 bg-primary/5" />
          </Item>
        )}
        {reviews.slice(0, 10).map((evt) => (
          <Item key={evt.id}>
            <RelayReviewCard event={evt} />
          </Item>
        ))}
        {reviews.length > 10 && (
          <Item>
            <div
              className="border rounded-lg bg-muted/20 p-3 flex items-center justify-center h-full hover:bg-muted cursor-pointer"
              onClick={() => push(toRelayReviews(relayUrl))}
            >
              <div className="text-sm text-muted-foreground">{t('View more reviews')}</div>
            </div>
          </Item>
        )}
      </CarouselContent>
      {showPreviousAndNext && <CarouselPrevious />}
      {showPreviousAndNext && <CarouselNext />}
    </Carousel>
  )
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <CarouselItem className="basis-11/12 lg:basis-2/3 2xl:basis-5/12 pl-0 pr-2">
      {children}
    </CarouselItem>
  )
}
