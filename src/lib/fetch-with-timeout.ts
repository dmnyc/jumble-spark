/** Default cap for HTTP fetches so tabs cannot hang indefinitely on bad networks or servers. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000

/**
 * `fetch` with a wall-clock timeout. Honors an optional caller `signal` (abort propagates both ways).
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, signal: userSignal, ...rest } = init
  const controller = new AbortController()

  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timeoutId = null
    controller.abort()
  }, timeoutMs)

  const onUserAbort = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    controller.abort()
  }

  if (userSignal) {
    if (userSignal.aborted) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    userSignal.addEventListener('abort', onUserAbort, { once: true })
  }

  try {
    return await fetch(input, { ...rest, signal: controller.signal })
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    userSignal?.removeEventListener('abort', onUserAbort)
  }
}
