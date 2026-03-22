import { kinds, NostrEvent } from 'nostr-tools'
import { ExtendedKind } from '@/constants'
import { hexPubkeysEqual } from '@/lib/pubkey'
import { isMentioningMutedUsers } from './event'
import { tagNameEquals } from './tag'

export function notificationFilter(
  event: NostrEvent,
  {
    pubkey,
    mutePubkeySet,
    hideContentMentioningMutedUsers,
    hideUntrustedNotifications,
    isUserTrusted
  }: {
    pubkey?: string | null
    mutePubkeySet: Set<string>
    hideContentMentioningMutedUsers?: boolean
    hideUntrustedNotifications?: boolean
    isUserTrusted: (pubkey: string) => boolean
  }
): boolean {
  if (
    mutePubkeySet.has(event.pubkey) ||
    (hideContentMentioningMutedUsers && isMentioningMutedUsers(event, mutePubkeySet)) ||
    (hideUntrustedNotifications && !isUserTrusted(event.pubkey))
  ) {
    return false
  }

  if (pubkey && event.kind === kinds.Reaction) {
    const targetPubkey = event.tags.findLast(tagNameEquals('p'))?.[1]
    if (!targetPubkey || !hexPubkeysEqual(targetPubkey, pubkey)) return false
  }

  // For PUBLIC_MESSAGE (kind 24) events, ensure the user is in the 'p' tags
  if (pubkey && event.kind === ExtendedKind.PUBLIC_MESSAGE) {
    const hasUserInPTags = event.tags.some(
      (tag) => tag[0] === 'p' && tag[1] && hexPubkeysEqual(tag[1], pubkey)
    )
    if (!hasUserInPTags) return false
  }

  return true
}
