import { normalizeUrl } from '@/lib/url'

export type TRelayPublishStatus = { url: string; success: boolean }

/** Normalized relay URLs that accepted the event (for follow-up REQ). */
export function successfulPublishRelayUrls(relayStatuses: TRelayPublishStatus[] | undefined): string[] {
  if (!relayStatuses?.length) return []
  return Array.from(
    new Set(
      relayStatuses
        .filter((s) => s.success)
        .map((s) => normalizeUrl(s.url) || s.url)
        .filter(Boolean)
    )
  )
}
