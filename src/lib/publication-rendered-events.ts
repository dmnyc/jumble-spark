import type { Event } from 'nostr-tools'

const renderedByPublication = new Map<string, Map<string, Event>>()
let renderedVersion = 0
const listeners = new Set<() => void>()

function normId(id: string): string {
  return id.trim().toLowerCase()
}

export function upsertRenderedPublicationEvents(publicationId: string, events: Event[]): void {
  const pubId = normId(publicationId)
  let byId = renderedByPublication.get(pubId)
  if (!byId) {
    byId = new Map<string, Event>()
    renderedByPublication.set(pubId, byId)
  }
  for (const ev of events) {
    if (!ev?.id) continue
    byId.set(normId(ev.id), ev)
  }
  renderedVersion += 1
  for (const listener of listeners) listener()
}

export function subscribeRenderedPublicationEvents(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRenderedPublicationEventsVersion(): number {
  return renderedVersion
}

export function getRenderedPublicationEvents(publicationId: string): Event[] {
  const pubId = normId(publicationId)
  return [...(renderedByPublication.get(pubId)?.values() ?? [])]
}

/**
 * Deep collection for nested 30040 publications that were rendered in this session.
 */
export function getRenderedPublicationEventsDeep(publicationId: string, maxDepth = 6): Event[] {
  const seenPublicationIds = new Set<string>()
  const outByEventId = new Map<string, Event>()

  const walk = (pubIdRaw: string, depth: number) => {
    const pubId = normId(pubIdRaw)
    if (depth > maxDepth || seenPublicationIds.has(pubId)) return
    seenPublicationIds.add(pubId)
    const direct = renderedByPublication.get(pubId)
    if (!direct) return
    for (const ev of direct.values()) {
      outByEventId.set(normId(ev.id), ev)
      if (ev.kind === 30040) {
        walk(ev.id, depth + 1)
      }
    }
  }

  walk(publicationId, 0)
  return [...outByEventId.values()]
}
