import { Card } from '@/components/ui/card'
import { ExtendedKind, POLL_TYPE } from '@/constants'
import { transformCustomEmojisInContent } from '@/lib/draft-event'
import { normalizeTopic } from '@/lib/discussion-topics'
import { createFakeEvent } from '@/lib/event'
import { randomString } from '@/lib/random'
import { cleanUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { TPollCreateData } from '@/types'
import { kinds, nip19 } from 'nostr-tools'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import { useMemo } from 'react'
import ContentPreview from '../../ContentPreview'
import Content from '../../Content'
import Highlight from '../../Note/Highlight'
import MarkdownArticle from '../../Note/MarkdownArticle/MarkdownArticle'
import AsciidocArticle from '../../Note/AsciidocArticle/AsciidocArticle'
import { HighlightData } from '../HighlightEditor'

export default function Preview({ 
  content, 
  className,
  kind = 1,
  highlightData,
  pollCreateData,
  mediaImetaTags,
  mediaUrl,
  articleMetadata,
  extraPreviewTags
}: { 
  content: string
  className?: string
  kind?: number
  highlightData?: HighlightData
  pollCreateData?: TPollCreateData
  mediaImetaTags?: string[][]
  mediaUrl?: string
  articleMetadata?: {
    title?: string
    summary?: string
    image?: string
    dTag?: string
    topics?: string[]
  }
  /** Merged into the fake event (e.g. kind 11 discussion title / topic tags). */
  extraPreviewTags?: string[][]
}) {
  const { content: processedContent, emojiTags, highlightTags, pollTags } = useMemo(
    () => {
      // Clean tracking parameters from URLs in the preview
      const cleanedContent = content.replace(
        /(https?:\/\/[^\s]+)/g,
        (url) => {
          try {
            return cleanUrl(url)
          } catch {
            return url
          }
        }
      )
      const { content: processed, emojiTags: tags } = transformCustomEmojisInContent(cleanedContent)
      const customShortcodes = tags.map((t) => t[1]).filter(Boolean)
      const withNativeEmojis = replaceStandardEmojiShortcodesInContent(processed, customShortcodes)
      
      // Build highlight tags if this is a highlight
      let highlightTags: string[][] = []
      if (kind === kinds.Highlights && highlightData) {
        // Add source tag
        if (highlightData.sourceType === 'url') {
          try {
            highlightTags.push([
              'r',
              cleanUrl(highlightData.sourceValue) || highlightData.sourceValue,
              'source'
            ])
          } catch {
            highlightTags.push(['r', highlightData.sourceValue, 'source'])
          }
        } else if (highlightData.sourceType === 'nostr') {
          // For preview, we'll use a simple e-tag with the source value
          // The actual tag building happens in createHighlightDraftEvent
          if (highlightData.sourceHexId) {
            highlightTags.push(['e', highlightData.sourceHexId])
          } else if (highlightData.sourceValue) {
            // Try to extract hex ID from bech32 if possible
            try {
              const decoded = nip19.decode(highlightData.sourceValue)
              if (decoded.type === 'note' || decoded.type === 'nevent') {
                const hexId = decoded.type === 'note' ? decoded.data : decoded.data.id
                highlightTags.push(['e', hexId])
              } else if (decoded.type === 'naddr') {
                const { kind, pubkey, identifier } = decoded.data
                highlightTags.push(['a', `${kind}:${pubkey}:${identifier}`])
              }
            } catch {
              // If decoding fails, just use the source value as-is for preview
              highlightTags.push(['r', highlightData.sourceValue])
            }
          }
        }
        
        // Add context tag if provided
        if (highlightData.context) {
          highlightTags.push(['context', highlightData.context])
        }
      }
      
      // Build poll tags if this is a poll
      let pollTags: string[][] = []
      if (kind === ExtendedKind.POLL && pollCreateData) {
        const validOptions = pollCreateData.options.filter((opt) => opt.trim())
        pollTags.push(...validOptions.map((option) => ['option', randomString(9), option.trim()]))
        pollTags.push(['polltype', pollCreateData.isMultipleChoice ? POLL_TYPE.MULTIPLE_CHOICE : POLL_TYPE.SINGLE_CHOICE])
        if (pollCreateData.endsAt) {
          pollTags.push(['endsAt', pollCreateData.endsAt.toString()])
        }
        if (pollCreateData.relays.length > 0) {
          pollCreateData.relays.forEach((relay) => {
            pollTags.push(['relay', relay])
          })
        }
      }
      
      return {
        content: withNativeEmojis,
        emojiTags: tags,
        highlightTags,
        pollTags
      }
    },
    [content, kind, highlightData, pollCreateData]
  )
  
  // Combine emoji tags, highlight tags, poll tags, media imeta tags, and article metadata tags
  const allTags = useMemo(() => {
    const tags = [...emojiTags, ...highlightTags, ...pollTags]
    // Add imeta tags for media (voice comments, etc.)
    if (mediaImetaTags && mediaImetaTags.length > 0) {
      tags.push(...mediaImetaTags)
    }
    // Add article metadata tags for article kinds
    if (articleMetadata && (kind === kinds.LongFormArticle || kind === ExtendedKind.WIKI_ARTICLE || kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN || kind === ExtendedKind.PUBLICATION_CONTENT)) {
      if (articleMetadata.dTag) {
        tags.push(['d', articleMetadata.dTag])
      }
      if (articleMetadata.title) {
        tags.push(['title', articleMetadata.title])
      }
      if (articleMetadata.summary) {
        tags.push(['summary', articleMetadata.summary])
      }
      if (articleMetadata.image) {
        tags.push(['image', articleMetadata.image])
      }
      if (articleMetadata.topics && articleMetadata.topics.length > 0) {
        const normalizedTopics = articleMetadata.topics
          .map(topic => normalizeTopic(topic.trim()))
          .filter(topic => topic.length > 0)
        tags.push(...normalizedTopics.map((topic) => ['t', topic]))
      }
    }
    if (extraPreviewTags?.length) {
      tags.push(...extraPreviewTags)
    }
    return tags
  }, [emojiTags, highlightTags, pollTags, mediaImetaTags, articleMetadata, kind, extraPreviewTags])
  
  const fakeEvent = useMemo(() => {
    // For voice comments, include the media URL in content if not already there
    let eventContent = processedContent
    if ((kind === ExtendedKind.VOICE_COMMENT || kind === ExtendedKind.VOICE) && mediaUrl && !processedContent.includes(mediaUrl)) {
      eventContent = mediaUrl + (processedContent ? '\n\n' + processedContent : '')
    }
    
    return createFakeEvent({ 
      content: eventContent, 
      tags: allTags,
      kind 
    })
  }, [processedContent, allTags, kind, mediaUrl])
  
  const selectableClass = 'select-text'
  // For polls, use ContentPreview to show poll properly
  if (kind === ExtendedKind.POLL) {
    return (
      <Card className={cn('p-3', className, selectableClass)}>
        <ContentPreview event={fakeEvent} />
      </Card>
    )
  }
  
  // For highlights, use the Highlight component for proper formatting
  if (kind === kinds.Highlights) {
    return (
      <Card className={cn('p-3', className, selectableClass)}>
        <Highlight event={fakeEvent} />
      </Card>
    )
  }

  // For kind 1 notes, use MarkdownArticle to match actual rendering
  // This ensures preview matches the final result (no Links section, correct image placement, proper line breaks)
  if (kind === kinds.ShortTextNote || kind === ExtendedKind.COMMENT || kind === ExtendedKind.VOICE_COMMENT) {
    return (
      <Card className={cn('p-3', className, selectableClass)}>
        <MarkdownArticle event={fakeEvent} hideMetadata={true} />
      </Card>
    )
  }

  if (kind === ExtendedKind.DISCUSSION) {
    return (
      <Card className={cn('p-3', className, selectableClass)}>
        <MarkdownArticle event={fakeEvent} hideMetadata={true} />
      </Card>
    )
  }

  // For LongFormArticle, use MarkdownArticle
  if (kind === kinds.LongFormArticle) {
    return (
      <Card className={cn('p-3', className, selectableClass)}>
        <MarkdownArticle event={fakeEvent} hideMetadata={true} />
      </Card>
    )
  }

  // For WikiArticle (AsciiDoc), use AsciidocArticle
  if (kind === ExtendedKind.WIKI_ARTICLE) {
    return (
      <Card className={cn('p-3', className, selectableClass)}>
        <AsciidocArticle event={fakeEvent} hideImagesAndInfo={false} />
      </Card>
    )
  }

  // For WikiArticleMarkdown, use MarkdownArticle
  if (kind === ExtendedKind.WIKI_ARTICLE_MARKDOWN) {
    return (
      <Card className={cn('p-3', className, selectableClass)}>
        <MarkdownArticle event={fakeEvent} hideMetadata={true} />
      </Card>
    )
  }

  // For PublicationContent, use AsciidocArticle
  if (kind === ExtendedKind.PUBLICATION_CONTENT) {
    return (
      <Card className={cn('p-3', className, selectableClass)}>
        <AsciidocArticle event={fakeEvent} hideImagesAndInfo={false} />
      </Card>
    )
  }

  return (
    <Card className={cn('p-3', className, selectableClass)}>
      <Content event={fakeEvent} className="h-full" mustLoadMedia />
    </Card>
  )
}
