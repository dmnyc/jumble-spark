import { ExtendedKind } from '@/constants'
import { extractHashtagsFromContent, normalizeTopic } from '@/lib/discussion-topics'
import { DISCUSSION_TOPICS } from '@/pages/primary/DiscussionsPage/discussionTopics'
import { Event } from 'nostr-tools'
import type { LucideIcon } from 'lucide-react'
import { Hash } from 'lucide-react'

/** Isolates TipTap post cache from the main note composer (see postEditorCache.generateCacheKey). */
export const THREAD_POST_EDITOR_PARENT = { id: '__jumble_thread_post_editor__' } as Event

export type TDiscussionDynamicTopics = {
  mainTopics: {
    id: string
    label: string
    count: number
    isMainTopic: boolean
    isSubtopic: boolean
    parentTopic?: string
  }[]
  subtopics: {
    id: string
    label: string
    count: number
    isMainTopic: boolean
    isSubtopic: boolean
    parentTopic?: string
  }[]
  allTopics: {
    id: string
    label: string
    count: number
    isMainTopic: boolean
    isSubtopic: boolean
    parentTopic?: string
  }[]
}

export type TTopicRow = { id: string; label: string; icon: LucideIcon }

type TopicListEntry = { id: string; label: string }

export function extractImagesFromContent(content: string): string[] {
  const imageRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?)/gi
  return content.match(imageRegex) || []
}

export function generateImetaTagsFromUrls(imageUrls: string[]): string[][] {
  return imageUrls.map((url) => ['imeta', 'url', url])
}

export function buildDiscussionNsfwTag(): string[] {
  return ['content-warning', '']
}

/** Match preset/dynamic list by id or exact label (case-insensitive); otherwise normalize as a new topic slug. */
export function resolveTopicFromInput(raw: string, topics: TopicListEntry[]): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  const byId = topics.find((x) => x.id === lower)
  if (byId) return byId.id
  const byLabel = topics.find((x) => x.label.toLowerCase() === lower)
  if (byLabel) return byLabel.id
  return normalizeTopic(trimmed)
}

export function displayTopicLabel(topicId: string, topics: TopicListEntry[]): string {
  const row = topics.find((x) => x.id === topicId)
  return row?.label ?? topicId
}

export function buildAllAvailableTopics(dynamicTopics?: TDiscussionDynamicTopics | null): TTopicRow[] {
  const combined: TTopicRow[] = [...DISCUSSION_TOPICS]

  if (dynamicTopics) {
    dynamicTopics.mainTopics.forEach((dynamicTopic) => {
      const isGroupsTopic = dynamicTopic.id === 'groups'
      combined.push({
        id: dynamicTopic.id,
        label: `${dynamicTopic.label} (${dynamicTopic.count}) ${isGroupsTopic ? '👥' : '🔥'}`,
        icon: Hash
      })
    })

    dynamicTopics.subtopics.forEach((dynamicTopic) => {
      const predefinedMainTopic = DISCUSSION_TOPICS.find(
        (pt) =>
          dynamicTopic.id.toLowerCase().includes(pt.id.toLowerCase()) ||
          pt.id.toLowerCase().includes(dynamicTopic.id.toLowerCase())
      )

      const relatedDynamicMainTopic = dynamicTopics.mainTopics.find(
        (dt) =>
          dynamicTopic.id.toLowerCase().includes(dt.id.toLowerCase()) ||
          dt.id.toLowerCase().includes(dynamicTopic.id.toLowerCase())
      )

      const parentTopic = predefinedMainTopic?.id || relatedDynamicMainTopic?.id

      if (parentTopic) {
        const parentIndex = combined.findIndex((topic) => topic.id === parentTopic)
        if (parentIndex !== -1) {
          combined.splice(parentIndex + 1, 0, {
            id: dynamicTopic.id,
            label: `  └─ ${dynamicTopic.label} (${dynamicTopic.count}) 📌`,
            icon: Hash
          })
        } else {
          combined.push({
            id: dynamicTopic.id,
            label: `${dynamicTopic.label} (${dynamicTopic.count}) 📌`,
            icon: Hash
          })
        }
      } else {
        const generalIndex = combined.findIndex((topic) => topic.id === 'general')
        if (generalIndex !== -1) {
          combined.splice(generalIndex + 1, 0, {
            id: dynamicTopic.id,
            label: `  └─ ${dynamicTopic.label} (${dynamicTopic.count}) 📌`,
            icon: Hash
          })
        } else {
          combined.push({
            id: dynamicTopic.id,
            label: `${dynamicTopic.label} (${dynamicTopic.count}) 📌`,
            icon: Hash
          })
        }
      }
    })
  }

  return combined
}

export function collectDiscussionThreadTags(params: {
  processedContent: string
  topicForTags: string
  title: string
  selectedGroup: string
  dynamicTopics?: TDiscussionDynamicTopics | null
  isReadingGroup: boolean
  author: string
  subject: string
  isNsfw: boolean
}): string[][] {
  const {
    processedContent,
    topicForTags,
    title,
    selectedGroup,
    dynamicTopics,
    isReadingGroup,
    author,
    subject,
    isNsfw
  } = params
  const images = extractImagesFromContent(processedContent)
  const hashtags = extractHashtagsFromContent(processedContent)
  const tags: string[][] = [['title', title.trim()], ['-']]

  if (topicForTags === 'groups' && selectedGroup) {
    tags.push(['h', selectedGroup])
  }

  if (topicForTags !== 'all' && topicForTags !== 'general' && topicForTags !== 'groups') {
    const selectedDynamicTopic = dynamicTopics?.allTopics.find((dt) => dt.id === topicForTags)

    if (selectedDynamicTopic?.isSubtopic) {
      const predefinedMainTopic = DISCUSSION_TOPICS.find(
        (pt) =>
          topicForTags.toLowerCase().includes(pt.id.toLowerCase()) ||
          pt.id.toLowerCase().includes(topicForTags.toLowerCase())
      )

      if (predefinedMainTopic) {
        tags.push(['t', normalizeTopic(predefinedMainTopic.id)])
        tags.push(['t', normalizeTopic(topicForTags)])
      } else {
        const relatedDynamicMainTopic = dynamicTopics?.mainTopics.find(
          (dt) =>
            topicForTags.toLowerCase().includes(dt.id.toLowerCase()) ||
            dt.id.toLowerCase().includes(topicForTags.toLowerCase())
        )

        if (relatedDynamicMainTopic) {
          tags.push(['t', normalizeTopic(relatedDynamicMainTopic.id)])
          tags.push(['t', normalizeTopic(topicForTags)])
        } else {
          tags.push(['t', normalizeTopic(topicForTags)])
        }
      }
    } else {
      tags.push(['t', normalizeTopic(topicForTags)])
    }
  }

  let uniqueHashtags = hashtags
  if (topicForTags !== 'all' && topicForTags !== 'general') {
    const selectedDynamicTopic = dynamicTopics?.allTopics.find((dt) => dt.id === topicForTags)

    if (selectedDynamicTopic?.isSubtopic) {
      const predefinedMainTopic = DISCUSSION_TOPICS.find(
        (pt) =>
          topicForTags.toLowerCase().includes(pt.id.toLowerCase()) ||
          pt.id.toLowerCase().includes(topicForTags.toLowerCase())
      )
      const relatedDynamicMainTopic = dynamicTopics?.mainTopics.find(
        (dt) =>
          topicForTags.toLowerCase().includes(dt.id.toLowerCase()) ||
          dt.id.toLowerCase().includes(topicForTags.toLowerCase())
      )

      const parentTopic = predefinedMainTopic?.id || relatedDynamicMainTopic?.id
      uniqueHashtags = hashtags.filter(
        (hashtag) =>
          hashtag !== normalizeTopic(topicForTags) && (parentTopic ? hashtag !== normalizeTopic(parentTopic) : true)
      )
    } else {
      uniqueHashtags = hashtags.filter((hashtag) => hashtag !== normalizeTopic(topicForTags))
    }
  }
  for (const hashtag of uniqueHashtags) {
    tags.push(['t', hashtag])
  }

  if (isReadingGroup) {
    if (!uniqueHashtags.includes('readings')) {
      tags.push(['t', 'readings'])
    }
    tags.push(['author', author.trim()])
    tags.push(['subject', subject.trim()])
  }

  if (images && images.length > 0) {
    tags.push(...generateImetaTagsFromUrls(images))
  }

  if (isNsfw) {
    tags.push(buildDiscussionNsfwTag())
  }

  return tags
}

export function discussionThreadDraftKindParams() {
  return { kind: ExtendedKind.DISCUSSION, parentEvent: THREAD_POST_EDITOR_PARENT }
}
