import { POLL_RESPONSE_RELAY_URLS } from '@/constants'
import { describe, expect, it } from 'vitest'
import { getPollResponseRelayUrls } from './poll'

describe('getPollResponseRelayUrls', () => {
  it('reads from the poll relays, the user relays and the large public relays', () => {
    const urls = getPollResponseRelayUrls(['wss://poll.example.com'], ['wss://me.example.com/'])

    expect(urls.slice(0, 2)).toEqual(['wss://poll.example.com/', 'wss://me.example.com/'])
    POLL_RESPONSE_RELAY_URLS.forEach((url) => expect(urls).toContain(url))
  })

  it('asks each relay once however it is written', () => {
    const urls = getPollResponseRelayUrls(['wss://nos.lol', 'wss://relay.damus.io/'], ['nos.lol'])

    expect(urls).toHaveLength(new Set(urls).size)
    expect(urls.filter((url) => url === 'wss://nos.lol/')).toHaveLength(1)
    expect(urls.filter((url) => url === 'wss://relay.damus.io/')).toHaveLength(1)
  })

  it('drops relay tags that are not URLs', () => {
    expect(getPollResponseRelayUrls(['not a url'])).toEqual(getPollResponseRelayUrls([]))
  })
})
