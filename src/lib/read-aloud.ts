import { ExtendedKind, READ_ALOUD_TTS_URL } from '@/constants'
import {
  buildPiperTtsCacheKey,
  getPiperTtsCacheBudget,
  getPiperTtsCacheTtlMs
} from '@/lib/piper-tts-cache-policy'
import indexedDb from '@/services/indexed-db.service'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { Event, kinds } from 'nostr-tools'

/** Keep each Piper request small: long JSON bodies and WAV responses can OOM or time out the server. */
const PIPER_CHUNK_MAX_CHARS = 3600

function readAloudEndpointForLog(): string {
  const u = READ_ALOUD_TTS_URL
  if (!u) return ''
  try {
    const parsed = new URL(u)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return u.length > 96 ? `${u.slice(0, 96)}…` : u
  }
}

export type ReadAloudResult = 'ok' | 'unsupported' | 'empty' | 'error'

export type ReadAloudPhase =
  | 'idle'
  | 'preparing'
  | 'requesting'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'done'
  | 'error'

export type ReadAloudEngine = 'idle' | 'piper' | 'webspeech'

export type ReadAloudSnapshot = {
  open: boolean
  title: string
  engine: ReadAloudEngine
  phase: ReadAloudPhase
  totalChunks: number
  currentChunkIndex: number
  /** Piper: chunks fully played (0 .. totalChunks). */
  chunksPlayed: number
  /** Piper: 0–1 within the current chunk (from media timeupdate). */
  chunkPlaybackRatio: number
  charCount: number
  requestSentAt: number | null
  responseReceivedAt: number | null
  playbackStartedAt: number | null
  finishedAt: number | null
  error: string | null
  /** True when Piper was tried first and we fell back to Web Speech (still playing or finished). */
  usedPiperFallback: boolean
  /** Piper failure message for the fallback notice (optional detail). */
  piperFallbackDetail: string | null
  /** No `READ_ALOUD_TTS_URL` — Piper was never available for this read-aloud. */
  readAloudPiperSkipped: boolean
  /** When the Piper path started (first UI frame); kept after fallback for the timeline. */
  readAloudPiperTryStartedAt: number | null
  volume: number
  backend: string
}

const initialSnapshot: ReadAloudSnapshot = {
  open: false,
  title: '',
  engine: 'idle',
  phase: 'idle',
  totalChunks: 0,
  currentChunkIndex: 0,
  chunksPlayed: 0,
  chunkPlaybackRatio: 0,
  charCount: 0,
  requestSentAt: null,
  responseReceivedAt: null,
  playbackStartedAt: null,
  finishedAt: null,
  error: null,
  usedPiperFallback: false,
  piperFallbackDetail: null,
  readAloudPiperSkipped: false,
  readAloudPiperTryStartedAt: null,
  volume: 1,
  backend: ''
}

let snapshot: ReadAloudSnapshot = { ...initialSnapshot }
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

function patchSnapshot(p: Partial<ReadAloudSnapshot>): void {
  snapshot = { ...snapshot, ...p }
  emit()
}

export function subscribeReadAloud(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => listeners.delete(onStoreChange)
}

export function getReadAloudSnapshot(): ReadAloudSnapshot {
  return snapshot
}

export function getReadAloudServerSnapshot(): ReadAloudSnapshot {
  return { ...initialSnapshot }
}

let readAloudAbort: AbortController | null = null
let readAloudAudio: HTMLAudioElement | null = null
let readAloudUserPaused = false
let unpauseResolvers: Array<() => void> = []

function resolveUnpauses(): void {
  const r = unpauseResolvers
  unpauseResolvers = []
  r.forEach((fn) => {
    fn()
  })
}

function waitUntilUnpaused(): Promise<void> {
  if (!readAloudUserPaused) return Promise.resolve()
  return new Promise((resolve) => {
    unpauseResolvers.push(resolve)
  })
}

/** Let the read-aloud modal paint Piper / status before fetch or Web Speech starts. */
function yieldForReadAloudUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, 48)
      })
    })
  })
}

export function closeReadAloudPlayer(): void {
  stopReadAloudPlayback()
  readAloudUserPaused = false
  unpauseResolvers = []
  snapshot = { ...initialSnapshot }
  emit()
}

const KINDS_WITH_METADATA_TITLE = new Set<number>([
  kinds.LongFormArticle,
  ExtendedKind.PUBLICATION,
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  ExtendedKind.WIKI_ARTICLE
])

function stopReadAloudPlayback(): void {
  readAloudAbort?.abort()
  readAloudAbort = null
  if (readAloudAudio) {
    const url = readAloudAudio.src
    const el = readAloudAudio
    el.onended = null
    el.onerror = null
    el.pause()
    el.removeAttribute('src')
    el.load()
    if (el.parentNode) {
      el.parentNode.removeChild(el)
    }
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  }
  readAloudAudio = null
  window.speechSynthesis?.cancel()
}

/** Cut index in `s` for the first chunk: prefer after whitespace so words stay intact; only split at `maxLen` if there is no space in the window. */
function splitAfterLastWhitespaceInWindow(s: string, maxLen: number): number {
  const window = s.slice(0, maxLen)
  for (let i = window.length - 1; i > 0; i--) {
    if (/\s/u.test(window[i]!)) {
      return i + 1
    }
  }
  return maxLen
}

function splitOversizedPiece(piece: string, maxLen: number): string[] {
  const out: string[] = []
  let s = piece
  while (s.length > maxLen) {
    const cut = splitAfterLastWhitespaceInWindow(s, maxLen)
    const part = s.slice(0, cut).trimEnd()
    if (part) out.push(part)
    s = s.slice(cut).trimStart()
  }
  if (s) out.push(s)
  return out
}

/** Split plain text into segments under Piper's practical request size (paragraph boundaries first). */
function splitTextIntoTtsChunks(text: string, maxLen: number = PIPER_CHUNK_MAX_CHARS): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  if (normalized.length <= maxLen) return [normalized]

  const paras = normalized
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''

  const flush = (): void => {
    if (current) {
      chunks.push(current)
      current = ''
    }
  }

  for (const para of paras) {
    if (para.length > maxLen) {
      flush()
      chunks.push(...splitOversizedPiece(para, maxLen))
      continue
    }
    const joined = current ? `${current}\n\n${para}` : para
    if (joined.length <= maxLen) {
      current = joined
    } else {
      flush()
      current = para
    }
  }
  flush()
  return chunks
}

/** Strip common Markdown / AsciiDoc / code so TTS reads plain text (same idea as NotePage preview). */
function stripMarkupForReadAloud(content: string): string {
  let text = content
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  text = text.replace(/^=+\s+/gm, '')
  text = text.replace(/_([^_]+)_/g, '$1')
  text = text.replace(/```[\s\S]*?```/g, '')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

function readAloudTitleFromEvent(event: Event): string {
  if (KINDS_WITH_METADATA_TITLE.has(event.kind)) {
    const meta = getLongFormArticleMetadataFromEvent(event)
    return meta.title?.trim() ?? ''
  }
  return ''
}

function buildReadAloudPlainText(event: Event): string {
  let raw = event.content?.trim() ?? ''
  if (KINDS_WITH_METADATA_TITLE.has(event.kind)) {
    const meta = getLongFormArticleMetadataFromEvent(event)
    const title = meta.title?.trim()
    if (title) {
      raw = `${title}. ${raw}`
    }
  }
  return stripMarkupForReadAloud(raw)
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

/** Fetch one Piper WAV blob; rethrows AbortError; throws Error with user-facing message on failure. */
async function fetchPiperTtsBlobForChunk(
  chunkIndex: number,
  totalChunks: number,
  text: string,
  signal: AbortSignal
): Promise<Blob> {
  const url = READ_ALOUD_TTS_URL
  if (!url) {
    throw new Error(`Part ${chunkIndex + 1} of ${totalChunks}: TTS URL not configured`)
  }

  const speed = 1
  const ttlMs = getPiperTtsCacheTtlMs()
  const budget = getPiperTtsCacheBudget()
  let cacheKey: string | undefined
  try {
    cacheKey = await buildPiperTtsCacheKey(url, text, speed)
    const hit = await indexedDb.getPiperTtsBlobCache(cacheKey, ttlMs)
    if (hit && hit.size > 0) {
      return hit
    }
  } catch {
    /* IndexedDB or crypto unavailable — fetch without cache */
  }

  let response: Response
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speed }),
      signal,
      timeoutMs: 120_000
    })
  } catch (e) {
    if (isAbortError(e)) {
      throw e
    }
    const msg = e instanceof Error ? e.message : String(e)
    logger.warn('[ReadAloud] Piper fetch failed (check CORS on the TTS host or use same-origin /api/piper-tts)', {
      endpoint: readAloudEndpointForLog(),
      error: msg
    })
    throw new Error(`Part ${chunkIndex + 1} of ${totalChunks}: ${msg}`)
  }

  if (!response.ok) {
    logger.warn('[ReadAloud] Piper HTTP error', {
      status: response.status,
      endpoint: readAloudEndpointForLog()
    })
    throw new Error(`Part ${chunkIndex + 1} of ${totalChunks}: HTTP ${response.status}`)
  }

  const blob = await response.blob()
  if (!blob.size) {
    logger.warn('[ReadAloud] Piper returned empty body', { endpoint: readAloudEndpointForLog() })
    throw new Error(`Part ${chunkIndex + 1} of ${totalChunks}: empty audio response`)
  }

  if (cacheKey) {
    try {
      const mime = blob.type || response.headers.get('Content-Type') || 'audio/wav'
      await indexedDb.putPiperTtsBlobCache(cacheKey, blob, mime, {
        ttlMs,
        maxEntries: budget.maxEntries,
        maxBytes: budget.maxBytes
      })
    } catch {
      /* cache write failure should not break playback */
    }
  }

  return blob
}

function playPiperBlob(blob: Blob, signal: AbortSignal): Promise<'ok' | 'error' | 'aborted'> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('aborted')
      return
    }

    const audioUrl = URL.createObjectURL(blob)
    const audio = new Audio()
    readAloudAudio = audio
    audio.volume = snapshot.volume
    audio.src = audioUrl
    audio.preload = 'auto'
    try {
      audio.setAttribute('data-jumble-read-aloud', '')
      audio.style.display = 'none'
      document.body.appendChild(audio)
    } catch {
      /* detached Audio() still works in most browsers */
    }

    let lastRatioEmit = 0

    const onPlay = (): void => {
      if (signal.aborted || readAloudAudio !== audio) return
      patchSnapshot({
        phase: 'playing',
        playbackStartedAt: snapshot.playbackStartedAt ?? Date.now()
      })
    }

    const onPause = (): void => {
      if (signal.aborted || readAloudAudio !== audio) return
      if (audio.ended) return
      patchSnapshot({ phase: 'paused' })
    }

    const onTimeUpdate = (): void => {
      if (signal.aborted || readAloudAudio !== audio) return
      const now = Date.now()
      if (now - lastRatioEmit < 150) return
      lastRatioEmit = now
      const d = audio.duration
      if (!d || !Number.isFinite(d) || d <= 0) return
      patchSnapshot({ chunkPlaybackRatio: Math.min(1, audio.currentTime / d) })
    }

    const cleanup = (): void => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.onended = null
      audio.onerror = null
      signal.removeEventListener('abort', onAbort)
      if (audio.parentNode) {
        audio.parentNode.removeChild(audio)
      }
      if (audio.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl)
      }
    }

    const onAbort = (): void => {
      cleanup()
      audio.pause()
      if (readAloudAudio === audio) {
        readAloudAudio = null
      }
      resolve('aborted')
    }

    signal.addEventListener('abort', onAbort)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('timeupdate', onTimeUpdate)

    audio.onended = (): void => {
      patchSnapshot({ chunkPlaybackRatio: 1 })
      cleanup()
      if (readAloudAudio === audio) {
        readAloudAudio = null
      }
      resolve('ok')
    }

    audio.onerror = (): void => {
      cleanup()
      if (readAloudAudio === audio) {
        readAloudAudio = null
      }
      resolve('error')
    }

    void audio.play().catch((playErr: unknown) => {
      logger.warn('[ReadAloud] Piper audio.play() blocked or failed', {
        endpoint: readAloudEndpointForLog(),
        error: playErr instanceof Error ? playErr.message : String(playErr)
      })
      cleanup()
      if (readAloudAudio === audio) {
        readAloudAudio = null
      }
      resolve('error')
    })
  })
}

async function speakViaPiperTtsChunks(chunks: string[]): Promise<ReadAloudResult> {
  stopReadAloudPlayback()
  readAloudAbort = new AbortController()
  const signal = readAloudAbort.signal

  if (chunks.length === 0) {
    return 'empty'
  }

  /** One promise per chunk index so playback always awaits section *i* before *i+1* (no reordering). */
  const chunkBlobPromises = new Map<number, Promise<Blob>>()

  const ensureChunkBlob = (index: number): Promise<Blob> => {
    let p = chunkBlobPromises.get(index)
    if (!p) {
      const text = chunks[index]
      if (text === undefined) {
        p = Promise.reject(new Error(`Part ${index + 1} of ${chunks.length}: missing text`))
      } else {
        p = fetchPiperTtsBlobForChunk(index, chunks.length, text, signal)
      }
      chunkBlobPromises.set(index, p)
    }
    return p
  }

  try {
    for (let i = 0; i < chunks.length; i++) {
      await waitUntilUnpaused()
      if (signal.aborted) {
        return 'ok'
      }

      const sentAt = Date.now()
      patchSnapshot({
        currentChunkIndex: i,
        chunksPlayed: i,
        phase: 'requesting',
        requestSentAt: sentAt,
        responseReceivedAt: null,
        chunkPlaybackRatio: 0
      })

      // Background-load the next section while this one is still fetching / playing.
      if (i + 1 < chunks.length) {
        ensureChunkBlob(i + 1).catch((e) => {
          if (isAbortError(e)) return
          /* Real errors surface when we await this index; this only avoids unhandled rejections on prefetch. */
        })
      }

      let blob: Blob
      try {
        blob = await ensureChunkBlob(i)
      } catch (e) {
        if (isAbortError(e)) {
          return 'ok'
        }
        const msg = e instanceof Error ? e.message : String(e)
        patchSnapshot({
          phase: 'error',
          error: msg
        })
        return 'error'
      }

      patchSnapshot({
        responseReceivedAt: Date.now(),
        phase: 'buffering'
      })

      await waitUntilUnpaused()
      if (signal.aborted) {
        return 'ok'
      }

      const played = await playPiperBlob(blob, signal)
      if (played === 'aborted') {
        return 'ok'
      }
      if (played === 'error') {
        patchSnapshot({
          phase: 'error',
          error: `Part ${i + 1} of ${chunks.length}: playback failed (browser blocked audio or corrupt WAV)`
        })
        return 'error'
      }
    }

    patchSnapshot({
      phase: 'done',
      finishedAt: Date.now(),
      currentChunkIndex: chunks.length - 1,
      chunksPlayed: chunks.length,
      chunkPlaybackRatio: 0
    })
    return 'ok'
  } finally {
    readAloudAbort = null
  }
}

async function speakViaWebSpeech(
  text: string,
  title: string,
  options?: { fromPiperFallback?: boolean; browserOnlyNoPiper?: boolean }
): Promise<ReadAloudResult> {
  stopReadAloudPlayback()
  readAloudUserPaused = false
  resolveUnpauses()

  if (!window.speechSynthesis) {
    patchSnapshot({
      open: true,
      title,
      engine: 'webspeech',
      phase: 'error',
      error: 'Speech synthesis is not available',
      charCount: text.length,
      backend: '',
      ...(!options?.fromPiperFallback ? { usedPiperFallback: false, piperFallbackDetail: null } : {}),
      ...(options?.browserOnlyNoPiper
        ? { readAloudPiperSkipped: true, readAloudPiperTryStartedAt: null }
        : !options?.fromPiperFallback
          ? { readAloudPiperSkipped: false, readAloudPiperTryStartedAt: null }
          : {})
    })
    return 'unsupported'
  }

  let webspeechPiperFields: Partial<ReadAloudSnapshot>
  if (options?.browserOnlyNoPiper) {
    webspeechPiperFields = {
      readAloudPiperSkipped: true,
      readAloudPiperTryStartedAt: null,
      backend: ''
    }
  } else if (options?.fromPiperFallback) {
    webspeechPiperFields = { readAloudPiperSkipped: false, backend: snapshot.backend }
  } else {
    webspeechPiperFields = {
      readAloudPiperSkipped: false,
      readAloudPiperTryStartedAt: null,
      backend: ''
    }
  }

  patchSnapshot({
    open: true,
    title,
    engine: 'webspeech',
    phase: 'buffering',
    charCount: text.length,
    totalChunks: 0,
    currentChunkIndex: 0,
    chunksPlayed: 0,
    chunkPlaybackRatio: 0,
    requestSentAt: null,
    responseReceivedAt: null,
    playbackStartedAt: null,
    finishedAt: null,
    error: null,
    ...(!options?.fromPiperFallback ? { usedPiperFallback: false, piperFallbackDetail: null } : {}),
    ...webspeechPiperFields
  })

  if (options?.browserOnlyNoPiper || options?.fromPiperFallback) {
    await yieldForReadAloudUi()
  }

  const u = new SpeechSynthesisUtterance(text)
  u.onstart = (): void => {
    patchSnapshot({
      phase: 'playing',
      playbackStartedAt: Date.now()
    })
  }
  u.onend = (): void => {
    patchSnapshot({
      phase: 'done',
      finishedAt: Date.now()
    })
  }
  u.onerror = (ev): void => {
    patchSnapshot({
      phase: 'error',
      error: ev.error ?? 'speech synthesis error'
    })
  }
  window.speechSynthesis.speak(u)
  return 'ok'
}

export async function speakNoteReadAloud(event: Event): Promise<ReadAloudResult> {
  if (typeof window === 'undefined') {
    return 'unsupported'
  }

  const text = buildReadAloudPlainText(event)
  if (!text) {
    return 'empty'
  }

  const title = readAloudTitleFromEvent(event)

  if (READ_ALOUD_TTS_URL) {
    stopReadAloudPlayback()
    readAloudUserPaused = false
    resolveUnpauses()

    const chunks = splitTextIntoTtsChunks(text, PIPER_CHUNK_MAX_CHARS)
    patchSnapshot({
      open: true,
      title,
      engine: 'piper',
      phase: 'preparing',
      charCount: text.length,
      totalChunks: chunks.length,
      currentChunkIndex: 0,
      chunksPlayed: 0,
      chunkPlaybackRatio: 0,
      requestSentAt: null,
      responseReceivedAt: null,
      playbackStartedAt: null,
      finishedAt: null,
      error: null,
      usedPiperFallback: false,
      piperFallbackDetail: null,
      readAloudPiperSkipped: false,
      readAloudPiperTryStartedAt: Date.now(),
      backend: readAloudEndpointForLog()
    })

    await yieldForReadAloudUi()

    const piperResult = await speakViaPiperTtsChunks(chunks)
    if (piperResult === 'ok') {
      return 'ok'
    }

    logger.warn(
      '[ReadAloud] Using Web Speech fallback — Piper did not play. See previous [ReadAloud] log or player error.',
      { endpoint: readAloudEndpointForLog() }
    )

    const prior = snapshot.error?.trim() || null
    patchSnapshot({
      engine: 'webspeech',
      phase: 'preparing',
      error: null,
      usedPiperFallback: true,
      piperFallbackDetail: prior,
      totalChunks: 0,
      currentChunkIndex: 0,
      chunksPlayed: 0,
      chunkPlaybackRatio: 0
    })

    return await speakViaWebSpeech(text, title, { fromPiperFallback: true })
  }

  return await speakViaWebSpeech(text, title, { browserOnlyNoPiper: true })
}
