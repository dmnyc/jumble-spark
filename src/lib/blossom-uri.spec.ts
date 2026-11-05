import { describe, expect, it } from 'vitest'
import { BLOSSOM_SCHEME, blossomCandidateUrl, isBlossomUri, parseBlossomUri } from './blossom-uri'

/**
 * Pins the BUD-10 `blossom:` reference parser — including the exact URI shape
 * seen in the field — and the scheme detection the media classification and
 * the content scanner rely on.
 */

const FIELD_URI =
  'blossom:d819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c.jpg' +
  '?xs=blossom.laantungir.net&xs=cdn.satellite.earth&xs=blossom.primal.net' +
  '&as=1ec454734dcbf6fe54901ce25c0c7c6bca5edd89443416761fadc321d38df139&sz=117475'

describe('parseBlossomUri', () => {
  it('parses the field URI: hash, extension, hints, author, size', () => {
    const uri = parseBlossomUri(FIELD_URI)
    expect(uri).not.toBeNull()
    expect(uri!.sha256).toBe('d819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c')
    expect(uri!.ext).toBe('jpg')
    expect(uri!.serverHints).toEqual([
      'blossom.laantungir.net',
      'cdn.satellite.earth',
      'blossom.primal.net'
    ])
    expect(uri!.authors).toEqual([
      '1ec454734dcbf6fe54901ce25c0c7c6bca5edd89443416761fadc321d38df139'
    ])
    expect(uri!.sizeBytes).toBe(117475)
  })

  it('parses a bare hash with no extension or query', () => {
    const uri = parseBlossomUri(`blossom:${'a'.repeat(64)}`)
    expect(uri!.sha256).toBe('a'.repeat(64))
    expect(uri!.ext).toBeNull()
    expect(uri!.serverHints).toEqual([])
    expect(uri!.sizeBytes).toBeNull()
  })

  it('rejects non-blossom and malformed references', () => {
    expect(parseBlossomUri(`https://cdn.satellite.earth/${'a'.repeat(64)}.jpg`)).toBeNull()
    expect(parseBlossomUri('blossom:xyz.jpg')).toBeNull()
    expect(parseBlossomUri('blossom:')).toBeNull()
    expect(parseBlossomUri('blossom:d819.jpg')).toBeNull()
  })
})

describe('blossomCandidateUrl', () => {
  it('uses the bare hash on https', () => {
    const uri = parseBlossomUri(FIELD_URI)!
    expect(blossomCandidateUrl(uri, 'blossom.laantungir.net')).toBe(
      'https://blossom.laantungir.net/d819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c'
    )
    // A hint that already carries a scheme is used as-is; trailing slashes are trimmed.
    expect(blossomCandidateUrl(uri, 'https://cdn.satellite.earth/')).toBe(
      'https://cdn.satellite.earth/d819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c'
    )
  })
})

describe('isBlossomUri', () => {
  it('is case-insensitive on the scheme and rejects everything else', () => {
    expect(isBlossomUri(FIELD_URI)).toBe(true)
    expect(isBlossomUri(`BLOSSOM:${'a'.repeat(64)}`)).toBe(true)
    expect(isBlossomUri('https://jumble.social')).toBe(false)
  })

  it('exposes the scheme constant', () => {
    expect(BLOSSOM_SCHEME).toBe('blossom:')
  })
})
