import {
  HASHTAG_REGEX,
  LN_INVOICE_REGEX,
  URL_REGEX,
  WS_URL_REGEX,
  YOUTUBE_URL_REGEX
} from '@/constants'
import {
  EMBEDDED_EVENT_REGEX,
  EMBEDDED_MENTION_REGEX,
  EMOJI_SHORT_CODE_REGEX,
  LEGACY_PROFILE_BECH32_REGEX
} from '@/lib/content-patterns'
import { PAYTO_URI_REGEX } from '@/lib/payto'
import { logContentSpacing, reprString } from '@/lib/content-spacing-debug'
import { isImage, isMedia } from './url'

export type TEmbeddedNodeType =
  | 'text'
  | 'image'
  | 'images'
  | 'media'
  | 'event'
  | 'mention'
  | 'legacy-mention'
  | 'hashtag'
  | 'websocket-url'
  | 'url'
  | 'emoji'
  | 'invoice'
  | 'youtube'
  | 'payto'

export type TEmbeddedNode =
  | {
      type: Exclude<TEmbeddedNodeType, 'images'>
      data: string
    }
  | {
      type: 'images'
      data: string[]
    }

type TContentParser =
  | { type: Exclude<TEmbeddedNodeType, 'images'>; regex: RegExp }
  | ((content: string) => TEmbeddedNode[])

export const EmbeddedHashtagParser: TContentParser = {
  type: 'hashtag',
  regex: HASHTAG_REGEX
}

export const EmbeddedMentionParser: TContentParser = {
  type: 'mention',
  regex: EMBEDDED_MENTION_REGEX
}

export const EmbeddedLegacyMentionParser: TContentParser = {
  type: 'legacy-mention',
  regex: LEGACY_PROFILE_BECH32_REGEX
}

export const EmbeddedEventParser: TContentParser = {
  type: 'event',
  regex: EMBEDDED_EVENT_REGEX
}

export const EmbeddedWebsocketUrlParser: TContentParser = {
  type: 'websocket-url',
  regex: WS_URL_REGEX
}

export const EmbeddedEmojiParser: TContentParser = {
  type: 'emoji',
  regex: EMOJI_SHORT_CODE_REGEX
}

export const EmbeddedLNInvoiceParser: TContentParser = {
  type: 'invoice',
  regex: LN_INVOICE_REGEX
}

/** payto:// URIs (RFC-8905 / NIP-A3) – e.g. in profile about or note content */
export const EmbeddedPaytoParser: TContentParser = {
  type: 'payto',
  regex: PAYTO_URI_REGEX
}

export const EmbeddedUrlParser: TContentParser = (content: string) => {
  const matches = content.matchAll(URL_REGEX)
  const result: TEmbeddedNode[] = []
  let lastIndex = 0
  
  // Helper function to check if URL is YouTube (use non-global regex to avoid state issues)
  const isYouTubeUrl = (url: string): boolean => {
    if (!url) return false
    const flags = YOUTUBE_URL_REGEX.flags.replace('g', '')
    const regex = new RegExp(YOUTUBE_URL_REGEX.source, flags)
    return regex.test(url)
  }
  
  for (const match of matches) {
    const matchStart = match.index!
    // Add text before the match
    if (matchStart > lastIndex) {
      result.push({
        type: 'text',
        data: content.slice(lastIndex, matchStart)
      })
    }

    const url = match[0]
    let type: TEmbeddedNodeType = 'url'
    if (isImage(url)) {
      type = 'image'
    } else if (isMedia(url)) {
      type = 'media'
    } else if (isYouTubeUrl(url)) {
      type = 'youtube'
    }

    // Add the match as specific type
    result.push({
      type,
      data: url
    })

    lastIndex = matchStart + url.length
  }
  // Add text after the last match
  if (lastIndex < content.length) {
    result.push({
      type: 'text',
      data: content.slice(lastIndex)
    })
  }
  return result
}

/**
 * Shared pipeline for kind-1–style strings (note body, reply preview, profile fields using parseContent).
 * Order matters.
 */
export const PARSE_CONTENT_PARSERS_NOTE_TEXT: TContentParser[] = [
  EmbeddedUrlParser,
  EmbeddedLNInvoiceParser,
  EmbeddedPaytoParser,
  EmbeddedWebsocketUrlParser,
  EmbeddedEventParser,
  EmbeddedMentionParser,
  EmbeddedHashtagParser,
  EmbeddedEmojiParser
]

export function parseContent(content: string, parsers: TContentParser[]) {
  const trace = content.includes('nostr:')
  if (trace) {
    logContentSpacing('parseContent:input', {
      rawLength: content.length,
      afterTrimRepr: reprString(content.trim()),
      trimRemovedLeading: content.length - content.trimStart().length,
      trimRemovedTrailing: content.length - content.trimEnd().length
    })
  }

  let nodes: TEmbeddedNode[] = [{ type: 'text', data: content.trim() }]

  parsers.forEach((parser, parserIndex) => {
    const parserLabel =
      typeof parser === 'function' ? `fn[${parserIndex}]` : parser.type
    const beforeSummary = trace ? summarizeContentNodesForDebug(nodes) : null

    nodes = nodes
      .flatMap((node) => {
        if (node.type !== 'text') return [node]

        if (typeof parser === 'function') {
          return parser(node.data)
        }

        const matches = node.data.matchAll(parser.regex)
        const result: TEmbeddedNode[] = []
        let lastIndex = 0
        for (const match of matches) {
          const matchStart = match.index!
          // Add text before the match
          if (matchStart > lastIndex) {
            result.push({
              type: 'text',
              data: node.data.slice(lastIndex, matchStart)
            })
          }

          // Add the match as specific type
          result.push({
            type: parser.type,
            data: match[0] // The whole matched string
          })

          lastIndex = matchStart + match[0].length
        }

        // Add text after the last match
        if (lastIndex < node.data.length) {
          result.push({
            type: 'text',
            data: node.data.slice(lastIndex)
          })
        }

        return result
      })
      .filter((n) => n.data !== '')

    if (trace) {
      logContentSpacing('parseContent:after-parser', {
        parser: parserLabel,
        parserIndex,
        before: beforeSummary,
        after: summarizeContentNodesForDebug(nodes)
      })
    }
  })

  nodes = mergeConsecutiveTextNodes(nodes)
  nodes = mergeConsecutiveImageNodes(nodes)
  nodes = removeExtraNewlines(nodes)

  if (trace) {
    logContentSpacing('parseContent:final', {
      afterMergeNewlines: summarizeContentNodesForDebug(nodes)
    })
  }

  return nodes
}

function summarizeContentNodesForDebug(nodes: TEmbeddedNode[]): Array<{ type: string; repr?: string }> {
  return nodes.map((n) => {
    if (n.type === 'text') return { type: 'text', repr: reprString(n.data) }
    if (n.type === 'images') return { type: 'images', repr: `[${n.data.length} urls]` }
    return { type: n.type, repr: typeof n.data === 'string' ? reprString(n.data) : undefined }
  })
}

function mergeConsecutiveTextNodes(nodes: TEmbeddedNode[]) {
  const merged: TEmbeddedNode[] = []
  let currentText = ''

  nodes.forEach((node) => {
    if (node.type === 'text') {
      currentText += node.data
    } else {
      if (currentText) {
        merged.push({ type: 'text', data: currentText })
        currentText = ''
      }
      merged.push(node)
    }
  })

  if (currentText) {
    merged.push({ type: 'text', data: currentText })
  }

  return merged
}

function mergeConsecutiveImageNodes(nodes: TEmbeddedNode[]) {
  const merged: TEmbeddedNode[] = []
  nodes.forEach((node, i) => {
    if (node.type === 'image') {
      const lastNode = merged[merged.length - 1]
      if (lastNode && lastNode.type === 'images') {
        lastNode.data.push(node.data)
      } else {
        merged.push({ type: 'images', data: [node.data] })
      }
    } else if (node.type === 'text' && node.data.trim() === '') {
      // Only remove whitespace-only text nodes if they are sandwiched between image nodes.
      const prev = merged[merged.length - 1]
      const next = nodes[i + 1]
      if (prev && prev.type === 'images' && next && next.type === 'image') {
        return // skip this whitespace node
      } else {
        merged.push(node)
      }
    } else {
      merged.push(node)
    }
  })

  return merged
}

function removeExtraNewlines(nodes: TEmbeddedNode[]) {
  const isBlockNode = (node: TEmbeddedNode) => {
    return ['image', 'images', 'video', 'event'].includes(node.type)
  }

  const newNodes: TEmbeddedNode[] = []
  nodes.forEach((node, i) => {
    if (isBlockNode(node)) {
      newNodes.push(node)
      return
    }

    const prev = nodes[i - 1]
    const next = nodes[i + 1]
    let data = node.data as string
    if (prev && isBlockNode(prev)) {
      data = data.replace(/^[ ]*\n/, '')
    }
    if (next && isBlockNode(next)) {
      data = data.replace(/\n[ ]*$/, '')
    }
    newNodes.push({
      type: node.type as Exclude<TEmbeddedNodeType, 'images'>,
      data
    })
  })
  return newNodes
}
