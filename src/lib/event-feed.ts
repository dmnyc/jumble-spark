import { Event, kinds } from 'nostr-tools'

export function getEventFeedTimestamp(event: Event) {
  if (event.kind !== kinds.LongFormArticle) return event.created_at

  const publishedAt = event.tags.find(([tagName]) => tagName === 'published_at')?.[1]
  if (!publishedAt || !/^\d+$/.test(publishedAt)) return event.created_at

  const timestamp = Number(publishedAt)
  return Number.isSafeInteger(timestamp) && timestamp <= event.created_at
    ? timestamp
    : event.created_at
}

function compareEventRevisions(a: Event, b: Event) {
  if (a.created_at !== b.created_at) {
    return a.created_at - b.created_at
  }
  if (a.id !== b.id) {
    return a.id < b.id ? 1 : -1
  }
  return 0
}

// Feed ordering differs from relay ordering for edited replaceable events.
// Fall back to revision ordering when two events have the same publication time.
export function compareFeedEvents(a: Event, b: Event): number {
  const timestampDiff = getEventFeedTimestamp(a) - getEventFeedTimestamp(b)
  return timestampDiff || compareEventRevisions(a, b)
}

type FeedItem<T> = {
  item: T
  event: Event
  timestamp: number
}

function compareFeedItemsDesc<T>(a: FeedItem<T>, b: FeedItem<T>) {
  return b.timestamp - a.timestamp || compareEventRevisions(b.event, a.event)
}

// The relay timeline is already ordered by revision time. Most events use that
// same time in feeds, so only edited replaceable events need to be relocated.
export function sortRevisionOrderedFeedItemsDesc<T>(items: T[], getEvent: (item: T) => Event): T[] {
  if (items.length < 2) return items

  const stationary: FeedItem<T>[] = []
  const relocated: FeedItem<T>[] = []
  let previous: FeedItem<T> | undefined
  let alreadySorted = true

  for (const item of items) {
    const event = getEvent(item)
    const feedItem = { item, event, timestamp: getEventFeedTimestamp(event) }
    if (previous && compareFeedItemsDesc(previous, feedItem) > 0) {
      alreadySorted = false
    }
    previous = feedItem

    if (feedItem.timestamp === event.created_at) {
      stationary.push(feedItem)
    } else {
      relocated.push(feedItem)
    }
  }

  if (alreadySorted) return items

  relocated.sort(compareFeedItemsDesc)

  const result: T[] = []
  let stationaryIndex = 0
  let relocatedIndex = 0
  while (stationaryIndex < stationary.length && relocatedIndex < relocated.length) {
    const stationaryItem = stationary[stationaryIndex]
    const relocatedItem = relocated[relocatedIndex]
    if (compareFeedItemsDesc(stationaryItem, relocatedItem) <= 0) {
      result.push(stationaryItem.item)
      stationaryIndex++
    } else {
      result.push(relocatedItem.item)
      relocatedIndex++
    }
  }

  while (stationaryIndex < stationary.length) {
    result.push(stationary[stationaryIndex++].item)
  }
  while (relocatedIndex < relocated.length) {
    result.push(relocated[relocatedIndex++].item)
  }
  return result
}

export function sortRevisionOrderedFeedEventsDesc(events: Event[]) {
  return sortRevisionOrderedFeedItemsDesc(events, (event) => event)
}

export function partitionIncomingFeedEvents(events: Event[], feedHeadTimestamp?: number) {
  if (feedHeadTimestamp === undefined) {
    return { recentEvents: events, historicalEvents: [] }
  }

  const recentEvents: Event[] = []
  const historicalEvents: Event[] = []
  for (const event of events) {
    if (getEventFeedTimestamp(event) > feedHeadTimestamp) {
      recentEvents.push(event)
    } else {
      historicalEvents.push(event)
    }
  }
  return { recentEvents, historicalEvents }
}

// Feed items are sorted descending, so unsafe items form one contiguous suffix.
// Scan back from the end, where only a few edited old events normally reside.
export function getSafeFeedItemCount<T>(
  items: T[],
  relayCreatedAtCursor: number | undefined,
  getEvent: (item: T) => Event
) {
  if (relayCreatedAtCursor === undefined) return items.length

  for (let index = items.length - 1; index >= 0; index--) {
    if (getEventFeedTimestamp(getEvent(items[index])) >= relayCreatedAtCursor) {
      return index + 1
    }
  }
  return 0
}
