import {
  EmbeddedHashtagParser,
  EmbeddedMentionParser,
  EmbeddedUrlParser,
  EmbeddedWebsocketUrlParser,
  parseContent
} from '@/lib/content-parser'
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
    EmbeddedHashtagParser,
    EmbeddedMentionParser
  ]).map((node, index) => {
    if (node.type === 'url') {
      return <EmbeddedNormalUrl key={index} url={node.data} />
    }
    if (node.type === 'websocket-url') {
      return <EmbeddedWebsocketUrl key={index} url={node.data} />
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
