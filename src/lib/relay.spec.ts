import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/local-storage.service', () => ({ default: {} }))

import { mergeRelayUrls } from './relay'

describe('mergeRelayUrls', () => {
  it('preserves group priority, removes duplicates, and applies the limit', () => {
    expect(
      mergeRelayUrls(
        5,
        ['wss://author-1.example/', 'wss://shared.example/'],
        ['wss://shared.example/', 'wss://default-1.example/', 'wss://default-2.example/'],
        ['wss://seen-1.example/', 'wss://seen-2.example/']
      )
    ).toEqual([
      'wss://author-1.example/',
      'wss://shared.example/',
      'wss://default-1.example/',
      'wss://default-2.example/',
      'wss://seen-1.example/'
    ])
  })

  it('can merge all relay groups without applying a limit', () => {
    expect(
      mergeRelayUrls(
        ['wss://base-1.example/', 'wss://shared.example/'],
        ['wss://shared.example/', 'wss://seen-1.example/', 'wss://seen-2.example/']
      )
    ).toEqual([
      'wss://base-1.example/',
      'wss://shared.example/',
      'wss://seen-1.example/',
      'wss://seen-2.example/'
    ])
  })
})
