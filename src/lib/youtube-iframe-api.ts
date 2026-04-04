/**
 * Loads YouTube’s iframe API exactly once. Multiple {@link YoutubeEmbeddedPlayer} instances must not each inject
 * `https://www.youtube.com/iframe_api` — that produced many duplicate &lt;script&gt; tags and broken callbacks.
 */
let iframeApiReadyPromise: Promise<void> | null = null

const IFRAME_API_URL = 'https://www.youtube.com/iframe_api'

function hasYtPlayer(): boolean {
  return !!(window as Window & { YT?: { Player?: unknown } }).YT?.Player
}

function scriptAlreadyPresent(): boolean {
  return !!document.querySelector(`script[src="${IFRAME_API_URL}"], script[src*="youtube.com/iframe_api"]`)
}

export function ensureYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (hasYtPlayer()) return Promise.resolve()

  if (!iframeApiReadyPromise) {
    iframeApiReadyPromise = new Promise<void>((resolve) => {
      const tryResolve = () => {
        if (hasYtPlayer()) resolve()
      }

      const chainReady = () => {
        const previous = window.onYouTubeIframeAPIReady
        window.onYouTubeIframeAPIReady = () => {
          previous?.()
          tryResolve()
        }
      }

      if (scriptAlreadyPresent()) {
        chainReady()
        const poll = () => {
          tryResolve()
          if (hasYtPlayer()) return
          requestAnimationFrame(poll)
        }
        poll()
        return
      }

      chainReady()
      const script = document.createElement('script')
      script.src = IFRAME_API_URL
      script.async = true
      document.body.appendChild(script)
    })
  }

  return iframeApiReadyPromise
}
