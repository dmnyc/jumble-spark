import { ExtendedKind, READ_ALOUD_TTS_URL } from '@/constants'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { Event, kinds } from 'nostr-tools'

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

const KINDS_WITH_METADATA_TITLE = new Set<number>([
  kinds.LongFormArticle,
  ExtendedKind.PUBLICATION,
  ExtendedKind.PUBLICATION_CONTENT,
  ExtendedKind.WIKI_ARTICLE_MARKDOWN,
  ExtendedKind.WIKI_ARTICLE
])

let readAloudAbort: AbortController | null = null
let readAloudAudio: HTMLAudioElement | null = null

function stopReadAloudPlayback(): void {
  readAloudAbort?.abort()
  readAloudAbort = null
  if (readAloudAudio) {
    const url = readAloudAudio.src
    readAloudAudio.onended = null
    readAloudAudio.onerror = null
    readAloudAudio.pause()
    readAloudAudio.removeAttribute('src')
    readAloudAudio.load()
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  }
  readAloudAudio = null
  window.speechSynthesis?.cancel()
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

/**
 * Piper / Wyoming proxy (aitherboard-compatible): POST JSON, receive WAV.
 */
async function speakViaPiperTts(text: string): Promise<ReadAloudResult> {
  stopReadAloudPlayback()
  readAloudAbort = new AbortController()

  try {
    const response = await fetch(READ_ALOUD_TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speed: 1 }),
      signal: readAloudAbort.signal
    })

    if (!response.ok) {
      logger.warn('[ReadAloud] Piper HTTP error', {
        status: response.status,
        endpoint: readAloudEndpointForLog()
      })
      return 'error'
    }

    const blob = await response.blob()
    if (!blob.size) {
      logger.warn('[ReadAloud] Piper returned empty body', { endpoint: readAloudEndpointForLog() })
      return 'error'
    }

    const audioUrl = URL.createObjectURL(blob)
    const audio = new Audio()
    readAloudAudio = audio
    audio.src = audioUrl

    const cleanupBlob = () => {
      if (audio.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl)
      }
    }

    audio.addEventListener('ended', () => {
      cleanupBlob()
      if (readAloudAudio === audio) {
        readAloudAudio = null
      }
    })
    audio.addEventListener('error', () => {
      cleanupBlob()
    })

    try {
      await audio.play()
      return 'ok'
    } catch (playErr) {
      logger.warn('[ReadAloud] Piper audio.play() blocked or failed', {
        endpoint: readAloudEndpointForLog(),
        error: playErr instanceof Error ? playErr.message : String(playErr)
      })
      cleanupBlob()
      if (readAloudAudio === audio) {
        readAloudAudio = null
      }
      return 'error'
    }
  } catch (e) {
    const isAbort =
      (e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && e.name === 'AbortError')
    if (isAbort) {
      return 'ok'
    }
    logger.warn('[ReadAloud] Piper fetch failed (check CORS on the TTS host or use same-origin /api/piper-tts)', {
      endpoint: readAloudEndpointForLog(),
      error: e instanceof Error ? e.message : String(e)
    })
    return 'error'
  }
}

function speakViaWebSpeech(text: string): void {
  stopReadAloudPlayback()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
}

export async function speakNoteReadAloud(event: Event): Promise<ReadAloudResult> {
  if (typeof window === 'undefined') {
    return 'unsupported'
  }

  const text = buildReadAloudPlainText(event)
  if (!text) {
    return 'empty'
  }

  if (READ_ALOUD_TTS_URL) {
    const piperResult = await speakViaPiperTts(text)
    if (piperResult === 'ok') {
      return 'ok'
    }
    logger.warn(
      '[ReadAloud] Using Web Speech fallback — Piper did not play. See previous [ReadAloud] log for cause.',
      { endpoint: readAloudEndpointForLog() }
    )
  }

  if (!window.speechSynthesis) {
    return READ_ALOUD_TTS_URL ? 'error' : 'unsupported'
  }

  speakViaWebSpeech(text)
  return 'ok'
}
