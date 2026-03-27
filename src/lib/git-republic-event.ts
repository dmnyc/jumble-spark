import { ExtendedKind, GITREPUBLIC_WEB_BASE_URL } from '@/constants'
import type { Event } from 'nostr-tools'
import { nip19 } from 'nostr-tools'

export type GitRepublicRepoContext = {
  ownerHex: string
  repoId: string
  /** From kind 30617 `name` tag when available */
  displayName?: string
}

/**
 * Resolve owner pubkey, repo id, and optional display name for Git Republic events.
 * Kind 30617 uses `d` + `name`; issues and releases reference the repo via `a` (30617:pubkey:repoId).
 */
export function getGitRepublicRepoContext(event: Event): GitRepublicRepoContext | null {
  if (event.kind === ExtendedKind.GIT_REPO_ANNOUNCEMENT) {
    const d = event.tags.find((t) => t[0] === 'd')?.[1]
    if (!d) return null
    return {
      ownerHex: event.pubkey,
      repoId: d,
      displayName: event.tags.find((t) => t[0] === 'name')?.[1]
    }
  }

  const a = event.tags.find((t) => t[0] === 'a')?.[1]
  if (!a) return null
  const parts = a.split(':')
  if (parts.length !== 3 || parts[0] !== String(ExtendedKind.GIT_REPO_ANNOUNCEMENT)) return null
  return { ownerHex: parts[1], repoId: parts[2] }
}

/** Accepts hex pubkey or `npub…` for Git Republic repo owner fields in forms. */
export function parseRepoOwnerPubkeyInput(input: string): string | null {
  const t = input.trim()
  if (!t) return null
  if (/^[0-9a-fA-F]{64}$/.test(t)) return t.toLowerCase()
  try {
    const dec = nip19.decode(t)
    if (dec.type === 'npub') return dec.data as string
  } catch {
    return null
  }
  return null
}

export function gitRepublicRepoWebUrl(ctx: GitRepublicRepoContext): string | null {
  try {
    const npub = nip19.npubEncode(ctx.ownerHex)
    const repo = encodeURIComponent(ctx.repoId)
    return `${GITREPUBLIC_WEB_BASE_URL}/repos/${npub}/${repo}`
  } catch {
    return null
  }
}
