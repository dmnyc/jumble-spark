import { cn } from '@/lib/utils'
import { getElectronBridge, isElectron } from '@/lib/platform'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import mediaManager from '@/services/media-manager.service'
import { YouTubePlayer } from '@/types/youtube'
import { memo, useEffect, useRef, useState } from 'react'

interface PlayerProps {
  videoId: string
  isShort: boolean
  className?: string
}

const wrapperClass = (isShort: boolean, className?: string) =>
  cn(
    'overflow-hidden rounded-xl border',
    isShort ? 'aspect-9/16 max-h-[80vh] sm:max-h-[60vh]' : 'aspect-video max-h-[60vh]',
    className
  )

let ytApiReady = false
const ytApiCallbacks: (() => void)[] = []

function ensureYTApi(callback: () => void) {
  if (ytApiReady && window.YT?.Player) {
    callback()
    return
  }

  ytApiCallbacks.push(callback)

  if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.body.appendChild(script)

    window.onYouTubeIframeAPIReady = () => {
      ytApiReady = true
      ytApiCallbacks.forEach((cb) => cb())
      ytApiCallbacks.length = 0
    }
  }
}

// Standard YouTube IFrame API PlayerState values — used as a fallback in
// Electron mode where the main frame doesn't load the IFrame API (the API
// runs inside the http:// shim iframe instead). mediaManager references
// window.YT.PlayerState.PLAYING/PAUSED/BUFFERING, so we publish the same
// constants up-front.
const YT_PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5
} as const

function ensureYTPlayerStateShim() {
  if (typeof window === 'undefined') return
  if (window.YT?.PlayerState) return
  ;(window as unknown as { YT: { PlayerState: typeof YT_PLAYER_STATE } }).YT = {
    ...(window.YT ?? {}),
    PlayerState: YT_PLAYER_STATE
  }
}

const WebPlayer = memo(({ videoId, isShort, className }: PlayerProps) => {
  const { muteMedia, updateMuteMedia } = useUserPreferences()
  const [initSuccess, setInitSuccess] = useState(false)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const muteStateRef = useRef(muteMedia)
  const playerIdRef = useRef(`yt-player-${Math.random().toString(36).substr(2, 9)}`)
  const unmountedRef = useRef(false)

  useEffect(() => {
    unmountedRef.current = false

    if (!videoId || !containerRef.current) return

    ensureYTApi(() => {
      if (!unmountedRef.current) {
        initPlayer()
      }
    })

    let checkMutedInterval: ReturnType<typeof setInterval> | null = null
    function initPlayer() {
      try {
        if (!videoId || !containerRef.current || !window.YT.Player || unmountedRef.current) return

        let currentMuteState = muteStateRef.current
        // Use string ID to avoid React DOM manipulation conflicts
        playerRef.current = new window.YT.Player(playerIdRef.current as any, {
          videoId: videoId,
          playerVars: {
            mute: currentMuteState ? 1 : 0
          },
          events: {
            onStateChange: (event: any) => {
              if (unmountedRef.current) return

              if (event.data === window.YT.PlayerState.PLAYING) {
                mediaManager.play(playerRef.current)
              } else if (
                event.data === window.YT.PlayerState.PAUSED ||
                event.data === window.YT.PlayerState.ENDED
              ) {
                mediaManager.pause(playerRef.current)
              }
            },
            onReady: () => {
              if (unmountedRef.current) {
                playerRef.current?.destroy()
                return
              }
              setInitSuccess(true)
              checkMutedInterval = setInterval(() => {
                if (
                  !playerRef.current ||
                  unmountedRef.current ||
                  typeof playerRef.current.isMuted !== 'function'
                ) {
                  if (checkMutedInterval) {
                    clearInterval(checkMutedInterval)
                    checkMutedInterval = null
                  }
                  return
                }
                const mute = playerRef.current.isMuted()
                if (mute !== currentMuteState) {
                  currentMuteState = mute

                  if (mute !== muteStateRef.current) {
                    updateMuteMedia(currentMuteState)
                  }
                } else if (muteStateRef.current !== mute) {
                  if (muteStateRef.current) {
                    playerRef.current.mute()
                  } else {
                    playerRef.current.unMute()
                  }
                }
              }, 200)
            },
            onError: (event: any) => {
              if (unmountedRef.current) return
              console.error('YouTube player error', event?.data)
            }
          }
        })
      } catch (error) {
        console.error('Failed to initialize YouTube player:', error)
        return
      }
    }

    return () => {
      unmountedRef.current = true
      if (checkMutedInterval) {
        clearInterval(checkMutedInterval)
        checkMutedInterval = null
      }
      if (playerRef.current) {
        try {
          playerRef.current.destroy()
        } catch {
          // Ignore errors during cleanup
        }
        playerRef.current = null
      }
    }
  }, [videoId])

  useEffect(() => {
    muteStateRef.current = muteMedia
  }, [muteMedia])

  useEffect(() => {
    const wrapper = wrapperRef.current

    if (!wrapper || !initSuccess) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        const player = playerRef.current
        if (!player || unmountedRef.current) return

        if (
          !entry.isIntersecting &&
          [window.YT.PlayerState.PLAYING, window.YT.PlayerState.BUFFERING].includes(
            player.getPlayerState()
          )
        ) {
          mediaManager.pause(player)
        }
      },
      { threshold: 1 }
    )

    observer.observe(wrapper)

    return () => {
      observer.unobserve(wrapper)
    }
  }, [initSuccess])

  return (
    <div ref={wrapperRef} className={wrapperClass(isShort, className)}>
      <div id={playerIdRef.current} ref={containerRef} className="h-full w-full" />
    </div>
  )
})
WebPlayer.displayName = 'YoutubeWebPlayer'

// Electron mode: the SPA runs on app:// for a stable storage origin, but the
// YouTube IFrame API rejects non-http(s) parent origins ("player error 153").
// We host a tiny shim page on http://127.0.0.1 (see electron/main/media-server.ts)
// in an <iframe>, load YT.Player inside it, and proxy commands/events across
// the iframe boundary via postMessage.
const ElectronPlayer = memo(({ videoId, isShort, className }: PlayerProps) => {
  const { muteMedia, updateMuteMedia } = useUserPreferences()
  const [initSuccess, setInitSuccess] = useState(false)
  const [shimOrigin, setShimOrigin] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const playerProxyRef = useRef<YouTubePlayer | null>(null)
  const stateRef = useRef<number>(YT_PLAYER_STATE.UNSTARTED)
  const mutedRef = useRef<boolean>(muteMedia)
  const muteStateRef = useRef(muteMedia)
  const unmountedRef = useRef(false)
  const initialMuteRef = useRef(muteMedia)

  useEffect(() => {
    ensureYTPlayerStateShim()
  }, [])

  useEffect(() => {
    let cancelled = false
    const bridge = getElectronBridge()
    if (!bridge) return
    bridge.media.getShimOrigin().then((origin) => {
      if (!cancelled) setShimOrigin(origin)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    muteStateRef.current = muteMedia
  }, [muteMedia])

  // Push preference changes (e.g. user toggled the global mute button) down
  // into the iframe player.
  useEffect(() => {
    if (!initSuccess || !shimOrigin) return
    if (muteMedia === mutedRef.current) return
    iframeRef.current?.contentWindow?.postMessage(
      { source: 'yt-host', type: muteMedia ? 'mute' : 'unmute' },
      shimOrigin
    )
  }, [muteMedia, initSuccess, shimOrigin])

  useEffect(() => {
    unmountedRef.current = false
    if (!shimOrigin) return

    const post = (type: string) => {
      iframeRef.current?.contentWindow?.postMessage({ source: 'yt-host', type }, shimOrigin)
    }

    const proxy: YouTubePlayer = {
      destroy: () => post('destroy'),
      playVideo: () => post('play'),
      pauseVideo: () => post('pause'),
      stopVideo: () => post('stop'),
      // currentTime / duration aren't read by mediaManager, IntersectionObserver,
      // or any caller in this codebase — return 0 rather than a stale cached value.
      getCurrentTime: () => 0,
      getDuration: () => 0,
      getPlayerState: () => stateRef.current,
      isMuted: () => mutedRef.current,
      mute: () => post('mute'),
      unMute: () => post('unmute')
    }
    playerProxyRef.current = proxy

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== shimOrigin) return
      const data = event.data as
        | { source?: string; type?: string; state?: number; muted?: boolean; code?: number }
        | undefined
      if (!data || data.source !== 'yt-shim') return
      if (unmountedRef.current) return

      switch (data.type) {
        case 'ready':
          setInitSuccess(true)
          break
        case 'state': {
          const newState = data.state ?? YT_PLAYER_STATE.UNSTARTED
          stateRef.current = newState
          if (newState === window.YT.PlayerState.PLAYING) {
            mediaManager.play(proxy)
          } else if (
            newState === window.YT.PlayerState.PAUSED ||
            newState === window.YT.PlayerState.ENDED
          ) {
            mediaManager.pause(proxy)
          }
          break
        }
        case 'muted': {
          const mute = !!data.muted
          mutedRef.current = mute
          if (mute !== muteStateRef.current) {
            updateMuteMedia(mute)
          }
          break
        }
        case 'error':
          console.error('YouTube player error', data.code)
          break
      }
    }

    window.addEventListener('message', onMessage)

    return () => {
      unmountedRef.current = true
      window.removeEventListener('message', onMessage)
      try {
        post('destroy')
      } catch {
        // Ignore — iframe may already be torn down
      }
      playerProxyRef.current = null
    }
  }, [shimOrigin, videoId, updateMuteMedia])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !initSuccess) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        const proxy = playerProxyRef.current
        if (!proxy || unmountedRef.current) return
        if (
          !entry.isIntersecting &&
          [window.YT.PlayerState.PLAYING, window.YT.PlayerState.BUFFERING].includes(
            stateRef.current
          )
        ) {
          mediaManager.pause(proxy)
        }
      },
      { threshold: 1 }
    )

    observer.observe(wrapper)
    return () => {
      observer.unobserve(wrapper)
    }
  }, [initSuccess])

  const iframeSrc = shimOrigin
    ? `${shimOrigin}/yt-shim.html?videoId=${encodeURIComponent(videoId)}` +
      `&mute=${initialMuteRef.current ? 1 : 0}` +
      `&parentOrigin=${encodeURIComponent(window.location.origin)}`
    : null

  return (
    <div ref={wrapperRef} className={wrapperClass(isShort, className)}>
      {iframeSrc && (
        <iframe
          key={videoId}
          ref={iframeRef}
          src={iframeSrc}
          className="block h-full w-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      )}
    </div>
  )
})
ElectronPlayer.displayName = 'YoutubeElectronPlayer'

const Player = memo((props: PlayerProps) => {
  return isElectron() ? <ElectronPlayer {...props} /> : <WebPlayer {...props} />
})

Player.displayName = 'YoutubePlayer'

export default Player
