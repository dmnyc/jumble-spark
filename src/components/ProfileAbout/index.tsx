import {
  EmbeddedHashtagParser,
  EmbeddedMentionParser,
  EmbeddedPaytoParser,
  EmbeddedUrlParser,
  EmbeddedWebsocketUrlParser,
  parseContent
} from '@/lib/content-parser'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import PaytoLink from '@/components/PaytoLink'
import { marked } from 'marked'
import {
  EmbeddedHashtag,
  EmbeddedMention,
  EmbeddedNormalUrl,
  EmbeddedWebsocketUrl
} from '../Embedded'

export default function ProfileAbout({ about, className }: { about?: string; className?: string }) {
  const normalized = replaceStandardEmojiShortcodesInContent(about ?? '', [])
  if (!normalized.trim()) return null

  const renderEnrichedText = (text: string, keyPrefix: string): React.ReactNode[] => {
    if (text.length === 0) return []
    const leadingWs = text.match(/^\s+/)?.[0] ?? ''
    const trailingWs = text.match(/\s+$/)?.[0] ?? ''
    const coreStart = leadingWs.length
    const coreEnd = text.length - trailingWs.length
    const core = text.slice(coreStart, coreEnd)

    const out: React.ReactNode[] = []
    if (leadingWs) {
      out.push(
        <span key={`${keyPrefix}-leading-ws`} className="whitespace-pre-wrap">
          {leadingWs}
        </span>
      )
    }

    if (core) {
      const coreNodes = parseContent(core, [
        EmbeddedWebsocketUrlParser,
        EmbeddedUrlParser,
        EmbeddedPaytoParser,
        EmbeddedHashtagParser,
        EmbeddedMentionParser
      ]).map((node, index) => {
        if (node.type === 'url') {
          return <EmbeddedNormalUrl key={`${keyPrefix}-url-${index}`} url={node.data} />
        }
        if (node.type === 'websocket-url') {
          return <EmbeddedWebsocketUrl key={`${keyPrefix}-ws-${index}`} url={node.data} />
        }
        if (node.type === 'payto') {
          return (
            <PaytoLink
              key={`${keyPrefix}-payto-${index}`}
              paytoUri={node.data}
              className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
            />
          )
        }
        if (node.type === 'hashtag') {
          return <EmbeddedHashtag key={`${keyPrefix}-hashtag-${index}`} hashtag={node.data} />
        }
        if (node.type === 'mention') {
          return <EmbeddedMention key={`${keyPrefix}-mention-${index}`} userId={node.data.split(':')[1]} />
        }
        return <span key={`${keyPrefix}-text-${index}`}>{node.data}</span>
      })
      out.push(...coreNodes)
    }

    if (trailingWs) {
      out.push(
        <span key={`${keyPrefix}-trailing-ws`} className="whitespace-pre-wrap">
          {trailingWs}
        </span>
      )
    }

    return out
  }

  const renderInlineTokens = (tokens: any[], keyPrefix: string): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const key = `${keyPrefix}-${i}`
      if (token.type === 'text' || token.type === 'escape') {
        out.push(...renderEnrichedText(String(token.text ?? token.raw ?? ''), `${key}-txt`))
      } else if (token.type === 'strong') {
        out.push(
          <strong key={`${key}-strong`}>
            {renderInlineTokens(token.tokens ?? [{ type: 'text', text: token.text ?? '' }], `${key}-strong`)}
          </strong>
        )
      } else if (token.type === 'em') {
        out.push(
          <em key={`${key}-em`}>
            {renderInlineTokens(token.tokens ?? [{ type: 'text', text: token.text ?? '' }], `${key}-em`)}
          </em>
        )
      } else if (token.type === 'del') {
        out.push(
          <del key={`${key}-del`} className="line-through">
            {renderInlineTokens(token.tokens ?? [{ type: 'text', text: token.text ?? '' }], `${key}-del`)}
          </del>
        )
      } else if (token.type === 'codespan') {
        out.push(
          <code key={`${key}-code`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
            {String(token.text ?? '')}
          </code>
        )
      } else if (token.type === 'br') {
        out.push(<br key={`${key}-br`} />)
      } else if (token.type === 'link') {
        const href = String(token.href ?? '')
        const label = String(token.text ?? href)
        if (href.startsWith('payto://')) {
          out.push(
            <PaytoLink
              key={`${key}-payto-link`}
              paytoUri={href}
              className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
            >
              {label}
            </PaytoLink>
          )
        } else {
          out.push(
            <a
              key={`${key}-link`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
            >
              {label}
            </a>
          )
        }
      } else {
        out.push(...renderEnrichedText(String(token.raw ?? token.text ?? ''), `${key}-fallback`))
      }
    }
    return out
  }

  const renderBlocks = (content: string): React.ReactNode[] => {
    const blocks = marked.lexer(content, { gfm: true, breaks: true }) as any[]
    const nodes: React.ReactNode[] = []
    for (let i = 0; i < blocks.length; i++) {
      const token = blocks[i]
      const key = `about-block-${i}`
      if (token.type === 'space') continue
      if (token.type === 'paragraph') {
        nodes.push(
          <p key={`${key}-p`} className="mb-1 last:mb-0">
            {renderInlineTokens(token.tokens ?? marked.Lexer.lexInline(token.text ?? ''), `${key}-inline`)}
          </p>
        )
        continue
      }
      if (token.type === 'list') {
        const ListTag = token.ordered ? 'ol' : 'ul'
        const listClass = token.ordered ? 'list-decimal list-outside ml-5 my-1' : 'list-disc list-outside ml-5 my-1'
        nodes.push(
          <ListTag key={`${key}-list`} className={listClass}>
            {(token.items ?? []).map((item: any, idx: number) => (
              <li key={`${key}-li-${idx}`}>
                {renderInlineTokens(item.tokens ?? marked.Lexer.lexInline(item.text ?? ''), `${key}-li-${idx}`)}
              </li>
            ))}
          </ListTag>
        )
        continue
      }
      if (token.type === 'heading') {
        const level = Math.min(Math.max(Number(token.depth || 1), 1), 6)
        const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements
        nodes.push(
          <HeadingTag key={`${key}-h`} className="mt-2 mb-1 font-semibold break-words">
            {renderInlineTokens(token.tokens ?? marked.Lexer.lexInline(token.text ?? ''), `${key}-heading-inline`)}
          </HeadingTag>
        )
        continue
      }
      if (token.type === 'blockquote') {
        nodes.push(
          <blockquote key={`${key}-bq`} className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
            {renderBlocks(String(token.text ?? token.raw ?? ''))}
          </blockquote>
        )
        continue
      }
      if (token.type === 'code') {
        nodes.push(
          <pre key={`${key}-code`} className="my-2 overflow-x-auto rounded bg-muted p-2 text-xs">
            <code>{String(token.text ?? '')}</code>
          </pre>
        )
        continue
      }
      nodes.push(
        <p key={`${key}-fallback`} className="mb-1 last:mb-0">
          {renderInlineTokens(marked.Lexer.lexInline(String(token.text ?? token.raw ?? '')), `${key}-fallback-inline`)}
        </p>
      )
    }
    return nodes
  }

  return <div className={className}>{renderBlocks(normalized)}</div>
}
