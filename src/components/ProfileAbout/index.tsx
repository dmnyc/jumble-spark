import {
  EmbeddedHashtagParser,
  EmbeddedMentionParser,
  EmbeddedPaytoParser,
  EmbeddedUrlParser,
  EmbeddedWebsocketUrlParser,
  parseContent
} from '@/lib/content-parser'
import PaytoLink from '@/components/PaytoLink'
import {
  EmbeddedHashtag,
  EmbeddedMention,
  EmbeddedNormalUrl,
  EmbeddedWebsocketUrl
} from '../Embedded'

export default function ProfileAbout({ about, className }: { about?: string; className?: string }) {
  const aboutNodes = parseContent(about ?? '', [
    EmbeddedWebsocketUrlParser,
    EmbeddedUrlParser,
    EmbeddedPaytoParser,
    EmbeddedHashtagParser,
    EmbeddedMentionParser
  ]).map((node, index) => {
    if (node.type === 'url') {
      return <EmbeddedNormalUrl key={index} url={node.data} />
    }
    if (node.type === 'websocket-url') {
      return <EmbeddedWebsocketUrl key={index} url={node.data} />
    }
    if (node.type === 'payto') {
      return (
        <PaytoLink
          key={index}
          paytoUri={node.data}
          className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:underline break-words"
        />
      )
    }
    if (node.type === 'hashtag') {
      return <EmbeddedHashtag key={index} hashtag={node.data} />
    }
    if (node.type === 'mention') {
      return <EmbeddedMention key={index} userId={node.data.split(':')[1]} />
    }
    return node.data
  })

  return <div className={className}>{aboutNodes}</div>
}
