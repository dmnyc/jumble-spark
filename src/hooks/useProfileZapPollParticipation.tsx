import { ExtendedKind, FAST_READ_RELAY_URLS, SEARCHABLE_RELAY_URLS } from '@/constants'
import {
  filterZapPollVoteReceiptsForVoter,
  getPollIdFromZapReceipt,
  parseZapPollEvent,
  userZapPollVoteOption
} from '@/lib/zap-poll'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'
import { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'

function participationRelayUrls(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of [...SEARCHABLE_RELAY_URLS, ...FAST_READ_RELAY_URLS]) {
    const n = normalizeUrl(u) || u
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out.slice(0, 14)
}

export type TZapPollProfileRow = {
  poll: Event
  voteReceipt: Event
  optionIndex: number
}

/**
 * Zap poll votes by `profilePubkey` (kind 9735 with P=profile and k=6969 in embedded zap request),
 * resolved to kind 6969 poll events for profile timeline merge.
 */
export function useProfileZapPollParticipation(profilePubkey: string | undefined) {
  const [rows, setRows] = useState<TZapPollProfileRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!profilePubkey) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      const urls = participationRelayUrls()
      const receipts = await client.fetchEvents(urls, {
        kinds: [kinds.Zap],
        '#p': [profilePubkey.trim().toLowerCase()],
        limit: 300
      })
      const voteReceipts = filterZapPollVoteReceiptsForVoter(receipts, profilePubkey)
      const pollIds = [...new Set(voteReceipts.map(getPollIdFromZapReceipt).filter(Boolean) as string[])]
      if (pollIds.length === 0) {
        setRows([])
        return
      }
      const polls = await client.fetchEvents(urls, {
        kinds: [ExtendedKind.ZAP_POLL],
        ids: pollIds,
        limit: pollIds.length
      })
      const pollById = new Map(polls.map((p) => [p.id, p]))
      const built: TZapPollProfileRow[] = []
      for (const vr of voteReceipts) {
        const pid = getPollIdFromZapReceipt(vr)
        if (!pid) continue
        const poll = pollById.get(pid)
        if (!poll) continue
        const pollMeta = parseZapPollEvent(poll)
        if (!pollMeta) continue
        const opt = userZapPollVoteOption(poll, pollMeta, profilePubkey, [vr])
        if (opt === undefined) continue
        built.push({ poll, voteReceipt: vr, optionIndex: opt })
      }
      built.sort((a, b) => b.voteReceipt.created_at - a.voteReceipt.created_at)
      setRows(built)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [profilePubkey])

  useEffect(() => {
    void load()
  }, [load])

  const pollIdsVoted = useMemo(() => new Set(rows.map((r) => r.poll.id)), [rows])

  return { rows, loading, reload: load, pollIdsVoted }
}
