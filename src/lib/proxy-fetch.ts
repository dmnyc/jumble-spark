import type {
  TProxyFetchOptions,
  TProxyFetchResponse
} from '../../electron/shared/ipc-types'
import { getElectronBridge, isElectron } from './platform'

const DEFAULT_TIMEOUT_MS = 15_000

export type ProxyFetchOptions = TProxyFetchOptions
export type ProxyFetchResponse = TProxyFetchResponse

/**
 * Fetch that routes through the Electron main process when available, so that
 * cross-origin requests bypass CORS and use the desktop network stack. In web
 * mode it falls back to `window.fetch` and adapts the response into the same
 * shape, so callers stay identical across platforms.
 *
 * The body is always returned as decoded UTF-8 text — callers parse JSON/HTML
 * themselves. This keeps the IPC payload simple and avoids shipping a DOM
 * parser into the main process.
 */
export async function proxyFetch(
  url: string,
  options: ProxyFetchOptions = {}
): Promise<ProxyFetchResponse> {
  if (isElectron()) {
    const bridge = getElectronBridge()
    if (bridge) {
      return bridge.proxy.fetch(url, options)
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )

  try {
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal
    })
    const body = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      url: res.url,
      headers,
      body
    }
  } finally {
    clearTimeout(timer)
  }
}
