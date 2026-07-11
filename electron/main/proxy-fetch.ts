import { app } from 'electron'
import type { TProxyFetchOptions, TProxyFetchResponse } from '../shared/ipc-types.js'

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_TIMEOUT_MS = 60_000
const MAX_BODY_BYTES = 5 * 1024 * 1024

const userAgent = `Jumble/${app.getVersion()} (Desktop; Electron)`

export async function proxyFetch(
  url: string,
  options: TProxyFetchOptions = {}
): Promise<TProxyFetchResponse> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed')
  }

  const timeoutMs = Math.min(
    Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000),
    MAX_TIMEOUT_MS
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      ...(options.headers ?? {})
    }

    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
      redirect: 'follow',
      signal: controller.signal
    })

    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    let oversize = false
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > MAX_BODY_BYTES) {
          oversize = true
          await reader.cancel()
          controller.abort()
          break
        }
        chunks.push(value)
      }
    }

    if (oversize) {
      console.warn(`[proxy-fetch] aborted: body exceeds ${MAX_BODY_BYTES} bytes ${url}`)
      return {
        ok: false,
        status: 0,
        statusText: 'Response body exceeds size limit',
        url: res.url,
        headers: {},
        body: ''
      }
    }

    const buf = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      buf.set(chunk, offset)
      offset += chunk.byteLength
    }
    const body = new TextDecoder('utf-8').decode(buf)

    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      url: res.url,
      headers: responseHeaders,
      body
    }
  } finally {
    clearTimeout(timer)
  }
}
