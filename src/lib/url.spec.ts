import { describe, expect, it } from 'vitest'
import { getSafeExternalUrl, isImage, isMedia, truncateUrl } from './url'

describe('getSafeExternalUrl', () => {
  it.each(['https://example.com/path', 'http://127.0.0.1:8080/file'])('allows web URL %s', (url) =>
    expect(getSafeExternalUrl(url)).toBe(url)
  )

  it.each([
    'javascript:alert(document.domain)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'nostr:npub1invalid',
    '/relative/path',
    'not a URL'
  ])('blocks non-web or invalid URL %s', (url) => {
    expect(getSafeExternalUrl(url)).toBeNull()
  })
})

describe('truncateUrl', () => {
  it('marks omitted query parameters with an ellipsis', () => {
    expect(truncateUrl('https://example.com/path?token=secret')).toBe('example.com/path...')
    expect(truncateUrl('https://example.com?token=secret')).toBe('example.com...')
  })

  it('marks an omitted fragment with an ellipsis', () => {
    expect(truncateUrl('https://example.com/path#section')).toBe('example.com/path...')
  })

  it('keeps the display URL within the maximum length when it has an omitted suffix', () => {
    const result = truncateUrl('https://example.com/a-long-path?token=secret', 20)

    expect(result).toBe('example.com/a-lon...')
    expect(result).toHaveLength(20)
  })

  it('does not add an ellipsis when no part of the URL is omitted', () => {
    expect(truncateUrl('https://example.com/path')).toBe('example.com/path')
  })
})

describe('isImage / isMedia on BUD-10 blossom URIs', () => {
  const FIELD_URI =
    'blossom:d819b922fbbf3a47e606dab12a6c316b9a0445ff4aa69d749d638ce83884cf1c.jpg' +
    '?xs=blossom.laantungir.net&xs=cdn.satellite.earth&xs=blossom.primal.net' +
    '&as=1ec454734dcbf6fe54901ce25c0c7c6bca5edd89443416761fadc321d38df139&sz=117475'

  it('classifies blossom references with image extensions as images', () => {
    expect(isImage(FIELD_URI)).toBe(true)
    expect(isImage(`blossom:${'a'.repeat(64)}.png`)).toBe(true)
  })

  it('does not treat blossom references with other extensions as images', () => {
    expect(isImage(`blossom:${'a'.repeat(64)}.mp4`)).toBe(false)
    expect(isImage(`blossom:${'a'.repeat(64)}`)).toBe(false)
  })

  it('classifies blossom references by the reference extension, not the query', () => {
    // The dotted server hints in the query must not leak into classification.
    expect(isMedia(`blossom:${'a'.repeat(64)}.mp4?xs=cdn.example.jpg`)).toBe(true)
    expect(isImage(`blossom:${'a'.repeat(64)}.mp4`)).toBe(false)
    expect(isMedia(FIELD_URI)).toBe(false)
  })
})
