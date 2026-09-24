import { afterEach, describe, expect, it, vi } from 'vitest'
import { getNostrConnectClientMetadata } from './nostr-connect'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getNostrConnectClientMetadata', () => {
  it('identifies the Electron client with its desktop project URL', () => {
    vi.stubGlobal('window', { electron: {} })
    vi.stubGlobal('document', {
      location: { host: 'renderer', origin: 'app://renderer' }
    })

    expect(getNostrConnectClientMetadata()).toEqual({
      name: 'Jumble(Desktop)'
    })
  })

  it('keeps the current site metadata in web mode', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {
      location: { host: 'beta.jumble.social', origin: 'https://beta.jumble.social' }
    })

    expect(getNostrConnectClientMetadata()).toEqual({
      name: 'beta.jumble.social',
      url: 'https://beta.jumble.social'
    })
  })
})
