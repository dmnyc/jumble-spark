import { getArticleUrlFromCommentITags } from '@/lib/rss-article'
import {
  getParentATag,
  getParentETag,
  getQuotedEventHexIdFromQTags,
  getRootATag,
  getRootETag,
  isNip25ReactionKind
} from '@/lib/event'
import { Event, kinds } from 'nostr-tools'
import { createContext, useCallback, useContext, useState } from 'react'

type TReplyContext = {
  repliesMap: Map<string, { events: Event[]; eventIdSet: Set<string> }>
  addReplies: (replies: Event[]) => void
}

const ReplyContext = createContext<TReplyContext | undefined>(undefined)

export const useReply = () => {
  const context = useContext(ReplyContext)
  if (!context) {
    throw new Error('useReply must be used within a ReplyProvider')
  }
  return context
}

export function ReplyProvider({ children }: { children: React.ReactNode }) {
  const [repliesMap, setRepliesMap] = useState<
    Map<string, { events: Event[]; eventIdSet: Set<string> }>
  >(new Map())

  const addReplies = useCallback((replies: Event[]) => {
    const newReplyIdSet = new Set<string>()
    const newReplyEventMap = new Map<string, Event[]>()
    replies.forEach((reply) => {
      if (newReplyIdSet.has(reply.id)) return
      if (isNip25ReactionKind(reply.kind)) return
      newReplyIdSet.add(reply.id)

      let rootId: string | undefined
      const rootETag = getRootETag(reply)
      if (rootETag) {
        rootId = rootETag[1]?.toLowerCase?.() ?? rootETag[1]
      } else {
        const rootATag = getRootATag(reply)
        if (rootATag) {
          rootId = rootATag[1]
        } else {
          const articleUrl = getArticleUrlFromCommentITags(reply)
          if (articleUrl) {
            rootId = articleUrl
          }
        }
      }
      if (rootId) {
        newReplyEventMap.set(rootId, [...(newReplyEventMap.get(rootId) || []), reply])
      }

      let parentId: string | undefined
      const parentETag = getParentETag(reply)
      if (parentETag) {
        parentId = parentETag[1]?.toLowerCase?.() ?? parentETag[1]
      } else {
        const parentATag = getParentATag(reply)
        if (parentATag) {
          parentId = parentATag[1]
        }
      }
      if (parentId && parentId !== rootId) {
        newReplyEventMap.set(parentId, [...(newReplyEventMap.get(parentId) || []), reply])
      }

      // Quote-only notes (#q, no e-tags): still index under the quoted event id.
      if (!rootId && !parentId) {
        const qid = getQuotedEventHexIdFromQTags(reply)
        if (qid) {
          newReplyEventMap.set(qid, [...(newReplyEventMap.get(qid) || []), reply])
        }
      }
    })
    if (newReplyEventMap.size === 0) return

    setRepliesMap((prev) => {
      const next = new Map(prev)
      for (const [id, newReplyEvents] of newReplyEventMap.entries()) {
        const existing = next.get(id)
        const events = existing ? [...existing.events] : []
        const eventIdSet = existing ? new Set(existing.eventIdSet) : new Set<string>()
        newReplyEvents.forEach((reply) => {
          const existingIdx = events.findIndex((e) => e.id === reply.id)
          if (existingIdx >= 0) {
            events[existingIdx] = reply
          } else {
            events.push(reply)
          }
          eventIdSet.add(reply.id)
        })
        next.set(id, { events, eventIdSet })
      }
      return next
    })
  }, [])

  return (
    <ReplyContext.Provider
      value={{
        repliesMap,
        addReplies
      }}
    >
      {children}
    </ReplyContext.Provider>
  )
}
