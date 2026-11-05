import { isBlossomUri, parseBlossomUri } from '@/lib/blossom-uri'
import { afterEach, describe, expect, it, vi } from 'vitest'
import blossomUriResolver from './blossom-uri-resolver.service'

const encoder = new TextEncoder()

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function jsonResponse(body: Uint8Array | string | null, status = 200) {
  return new Response(body ?? null, { status })
}

async function makeUri(payload: string, hints: string[]): Promise<string> {
  const hash = await sha256Hex(encoder.encode(payload))
  const query = hints.map((hint) => `xs=${hint}`).join('&')
  return `blossom:${hash}.jpg?${query}`
}

// The service is a singleton with persistent caches; distinct payloads give
// each test its own URI and cache keys.
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BlossomUriResolverService', () => {
  it('resolves a URI against its xs hints on the BUD-01 route', async () => {
    const payload = 'real blob'
    const uri = await makeUri(payload, ['s1.example.com'])
    const hash = parseBlossomUri(uri)!.sha256
    const fetchMock = vi.fn((url: string) => {
      expect(url).toBe(`https://s1.example.com/${hash}`)
      return Promise.resolve(jsonResponse(encoder.encode(payload)))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(blossomUriResolver.resolve(uri)).resolves.toBe(`https://s1.example.com/${hash}`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls through a server that answers 200 with the wrong bytes', async () => {
    const good = encoder.encode('the real blob')
    const hash = await sha256Hex(good)
    const uri = `blossom:${hash}.jpg?xs=bad.example.com&xs=good.example.com`
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('https://bad.example.com/')
          ? jsonResponse(encoder.encode('placeholder'))
          : jsonResponse(good)
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(blossomUriResolver.resolve(uri)).resolves.toBe(`https://good.example.com/${hash}`)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches a resolution and never refetches for the same URI', async () => {
    const payload = 'cached blob'
    const uri = await makeUri(payload, ['s1.example.com'])
    const hash = parseBlossomUri(uri)!.sha256
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(encoder.encode(payload))))
    vi.stubGlobal('fetch', fetchMock)

    const first = await blossomUriResolver.resolve(uri)
    const second = await blossomUriResolver.resolve(uri)
    expect(first).toBe(`https://s1.example.com/${hash}`)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(blossomUriResolver.peek(uri)).toBe(first)
  })

  it('caches a miss so an unreachable blob is not re-fetched on every ask', async () => {
    const uri = await makeUri('no server has this', ['s1.example.com'])
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(encoder.encode('wrong bytes'))))
    vi.stubGlobal('fetch', fetchMock)

    await expect(blossomUriResolver.resolve(uri)).resolves.toBeNull()
    const callsAfterFirst = fetchMock.mock.calls.length
    await expect(blossomUriResolver.resolve(uri)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirst)
  })

  it('treats non-200 answers as misses and moves on', async () => {
    const good = encoder.encode('lives on the second server')
    const hash = await sha256Hex(good)
    const uri = `blossom:${hash}.jpg?xs=down.example.com&xs=up.example.com`
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('https://down.example.com/') ? jsonResponse(null, 404) : jsonResponse(good)
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(blossomUriResolver.resolve(uri)).resolves.toBe(`https://up.example.com/${hash}`)
  })

  it('rejects URIs it cannot parse without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(blossomUriResolver.resolve('blossom:not-a-hash')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isBlossomUri('blossom:not-a-hash')).toBe(true)
  })
})
