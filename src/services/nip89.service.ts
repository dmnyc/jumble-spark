import { ExtendedKind } from '@/constants'
import { Event, kinds } from 'nostr-tools'

export interface ApplicationHandlerInfo {
  name: string
  description?: string
  website?: string
  picture?: string
  supportedKinds: number[]
  platforms: {
    web?: string
    ios?: string
    android?: string
    desktop?: string
  }
  relays: string[]
}

export interface ApplicationHandlerRecommendation {
  supportedKind: number
  handlers: Array<{
    pubkey: string
    identifier: string
    relay: string
    platform?: string
  }>
}

class Nip89Service {
  static instance: Nip89Service

  constructor() {
    if (Nip89Service.instance) {
      return Nip89Service.instance
    }
    Nip89Service.instance = this
  }

  /**
   * Create a NIP-89 application handler info event (kind 31990)
   */
  createApplicationHandlerInfoEvent(
    pubkey: string,
    handlerInfo: ApplicationHandlerInfo,
    identifier: string = 'main'
  ): Omit<Event, 'id' | 'sig'> {
    const content = JSON.stringify({
      name: handlerInfo.name,
      description: handlerInfo.description,
      website: handlerInfo.website,
      picture: handlerInfo.picture
    })

    const tags: string[][] = [
      ['d', identifier],
      ...handlerInfo.supportedKinds.map(kind => ['k', kind.toString()]),
      ...handlerInfo.relays.map(relay => ['relay', relay])
    ]

    // Add platform-specific handlers
    if (handlerInfo.platforms.web) {
      tags.push(['web', handlerInfo.platforms.web, 'nevent'])
    }
    if (handlerInfo.platforms.ios) {
      tags.push(['ios', handlerInfo.platforms.ios, 'nevent'])
    }
    if (handlerInfo.platforms.android) {
      tags.push(['android', handlerInfo.platforms.android, 'nevent'])
    }
    if (handlerInfo.platforms.desktop) {
      tags.push(['desktop', handlerInfo.platforms.desktop, 'nevent'])
    }

    return {
      kind: ExtendedKind.APPLICATION_HANDLER_INFO,
      pubkey,
      content,
      created_at: Math.floor(Date.now() / 1000),
      tags
    }
  }

  /**
   * Create a NIP-89 application handler recommendation event (kind 31989)
   */
  createApplicationHandlerRecommendationEvent(
    pubkey: string,
    recommendation: ApplicationHandlerRecommendation
  ): Omit<Event, 'id' | 'sig'> {
    const tags: string[][] = [
      ['d', recommendation.supportedKind.toString()],
      ...recommendation.handlers.map(handler => {
        const aTag = `31990:${handler.pubkey}:${handler.identifier}`
        const tag = ['a', aTag, handler.relay]
        if (handler.platform) {
          tag.push(handler.platform)
        }
        return tag
      })
    ]

    return {
      kind: ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION,
      pubkey,
      content: '',
      created_at: Math.floor(Date.now() / 1000),
      tags
    }
  }

  /**
   * Parse application handler info from a kind 31990 event
   */
  parseApplicationHandlerInfo(event: Event): ApplicationHandlerInfo | null {
    if (event.kind !== ExtendedKind.APPLICATION_HANDLER_INFO) {
      return null
    }

    let metadata: any = {}
    try {
      metadata = JSON.parse(event.content || '{}')
    } catch {
      // If parsing fails, use empty object
    }

    const supportedKinds: number[] = []
    const platforms: ApplicationHandlerInfo['platforms'] = {}
    const relays: string[] = []

    for (const tag of event.tags) {
      if (tag[0] === 'k' && tag[1]) {
        const kind = parseInt(tag[1])
        if (!isNaN(kind)) {
          supportedKinds.push(kind)
        }
      } else if (tag[0] === 'relay' && tag[1]) {
        relays.push(tag[1])
      } else if (tag[0] === 'web' && tag[1]) {
        platforms.web = tag[1]
      } else if (tag[0] === 'ios' && tag[1]) {
        platforms.ios = tag[1]
      } else if (tag[0] === 'android' && tag[1]) {
        platforms.android = tag[1]
      } else if (tag[0] === 'desktop' && tag[1]) {
        platforms.desktop = tag[1]
      }
    }

    return {
      name: metadata.name || 'Unknown Application',
      description: metadata.description,
      website: metadata.website,
      picture: metadata.picture,
      supportedKinds,
      platforms,
      relays
    }
  }

  /**
   * Parse application handler recommendation from a kind 31989 event
   */
  parseApplicationHandlerRecommendation(event: Event): ApplicationHandlerRecommendation | null {
    if (event.kind !== ExtendedKind.APPLICATION_HANDLER_RECOMMENDATION) {
      return null
    }

    const dTag = event.tags.find(tag => tag[0] === 'd')
    if (!dTag || !dTag[1]) {
      return null
    }

    const supportedKind = parseInt(dTag[1])
    if (isNaN(supportedKind)) {
      return null
    }

    const handlers = event.tags
      .filter(tag => tag[0] === 'a' && tag[1])
      .map(tag => {
        const aTag = tag[1]
        const parts = aTag.split(':')
        if (parts.length !== 3 || parts[0] !== '31990') {
          return null
        }

        return {
          pubkey: parts[1],
          identifier: parts[2],
          relay: tag[2] || '',
          platform: tag[3]
        }
      })
      .filter((handler): handler is NonNullable<typeof handler> => handler !== null)

    return {
      supportedKind,
      handlers
    }
  }

  /**
   * Create the Imwald application handler info event (NIP-89).
   */
  createImwaldHandlerInfo(pubkey: string): Omit<Event, 'id' | 'sig'> {
    const handlerInfo: ApplicationHandlerInfo = {
      name: 'Imwald',
      description: 'A modern Nostr client with advanced features for content discovery, discussions, and community building.',
      website: 'https://jumble.imwald.eu',
      picture: 'https://jumble.imwald.eu/og-image.png',
      supportedKinds: [
        kinds.ShortTextNote,
        kinds.Repost,
        ExtendedKind.GENERIC_REPOST,
        kinds.Reaction,
        kinds.Zap,
        kinds.LongFormArticle,
        kinds.Highlights,
        ExtendedKind.PICTURE,
        ExtendedKind.VIDEO,
        ExtendedKind.SHORT_VIDEO,
        ExtendedKind.POLL,
        ExtendedKind.COMMENT,
        ExtendedKind.VOICE,
        ExtendedKind.VOICE_COMMENT,
        ExtendedKind.DISCUSSION,
        ExtendedKind.RELAY_REVIEW,
        ExtendedKind.PUBLICATION,
        ExtendedKind.WIKI_ARTICLE,
      ],
      platforms: {
        web: 'https://jumble.imwald.eu/note/bech32',
        ios: 'imwald://note/bech32',
        android: 'imwald://note/bech32',
        desktop: 'imwald://note/bech32'
      },
      relays: [
        'wss://relay.damus.io',
        'wss://relay.snort.social',
        'wss://nos.lol',
        'wss://relay.nostr.band'
      ]
    }

    return this.createApplicationHandlerInfoEvent(pubkey, handlerInfo, 'imwald')
  }
}

export default new Nip89Service()
