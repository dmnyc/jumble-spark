import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  closeReadAloudPlayer,
  getReadAloudServerSnapshot,
  getReadAloudSnapshot,
  subscribeReadAloud,
  type ReadAloudSnapshot
} from '@/lib/read-aloud'
import { cn } from '@/lib/utils'
import type { TFunction } from 'i18next'
import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

function formatClock(ts: number | null): string {
  if (ts == null) return '—'
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return '—'
  }
}

/** Lighter scrim than default bg-black/80; content stays above overlay (z-230 vs z-220). */
const READ_ALOUD_OVERLAY_CLASS =
  'z-[220] bg-black/35 backdrop-blur-sm dark:bg-black/40'

function sectionAriaLabel(i: number, snap: ReadAloudSnapshot, t: TFunction): string {
  if (i < snap.chunksPlayed) {
    return t('Read-aloud section done', { index: i + 1 })
  }
  if (i > snap.currentChunkIndex) {
    return t('Read-aloud section pending', { index: i + 1 })
  }
  switch (snap.phase) {
    case 'requesting':
      return t('Read-aloud section fetching', { index: i + 1 })
    case 'buffering':
    case 'preparing':
      return t('Read-aloud section preparing audio', { index: i + 1 })
    case 'playing':
      return t('Read-aloud section playing', { index: i + 1 })
    case 'paused':
      return t('Read-aloud section paused', { index: i + 1 })
    default:
      return t('Read-aloud section pending', { index: i + 1 })
  }
}

function phaseLabel(s: ReadAloudSnapshot, t: (k: string) => string): string {
  switch (s.phase) {
    case 'idle':
      return t('Read-aloud idle')
    case 'preparing':
      return t('Preparing read-aloud…')
    case 'requesting':
      return t('Requesting audio…')
    case 'buffering':
      return t('Loading audio…')
    case 'playing':
      return t('Playing')
    case 'paused':
      return t('Paused')
    case 'done':
      return t('Read-aloud finished')
    case 'error':
      return t('Read-aloud error')
    default:
      return s.phase
  }
}

export default function ReadAloudPlayerModal(): JSX.Element {
  const { t } = useTranslation()
  const snap = useSyncExternalStore(
    subscribeReadAloud,
    getReadAloudSnapshot,
    getReadAloudServerSnapshot
  )

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) {
      closeReadAloudPlayer()
    }
  }, [])

  const showChunks = snap.engine === 'piper' && snap.totalChunks > 0

  const nChunks = snap.totalChunks
  const overallPct =
    nChunks > 0
      ? Math.min(100, ((snap.chunksPlayed + snap.chunkPlaybackRatio) / nChunks) * 100)
      : 0

  return (
    <Dialog open={snap.open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[230] max-w-md border-2 border-border bg-card shadow-2xl"
        overlayClassName={READ_ALOUD_OVERLAY_CLASS}
      >
        <DialogHeader>
          <DialogTitle className="pr-8 text-foreground">{t('Read aloud')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {snap.title ? (
            <p className="font-medium text-foreground line-clamp-2">{snap.title}</p>
          ) : null}
          <p className="text-muted-foreground">{phaseLabel(snap, t)}</p>
          {snap.engine === 'piper' ? (
            <p className="text-xs text-muted-foreground break-all">
              {t('TTS endpoint')}: {snap.backend || '—'}
            </p>
          ) : snap.engine === 'webspeech' ? (
            <p className="text-xs text-muted-foreground">{t('Using browser speech synthesis')}</p>
          ) : null}
          {snap.readAloudPiperSkipped ||
          snap.readAloudPiperTryStartedAt != null ||
          snap.usedPiperFallback ? (
            <div
              className={cn(
                'space-y-1.5 rounded-md border px-3 py-2 text-xs',
                snap.readAloudPiperSkipped
                  ? 'border-sky-500/35 bg-sky-500/10'
                  : 'border-border bg-muted/40'
              )}
              role="region"
              aria-label={t('Read-aloud Piper status region')}
            >
              <p className="font-semibold text-foreground">{t('Read-aloud Piper status heading')}</p>
              {snap.readAloudPiperSkipped ? (
                <p className="text-muted-foreground">{t('Read-aloud Piper skipped notice')}</p>
              ) : null}
              {snap.readAloudPiperTryStartedAt != null ? (
                <p className="text-muted-foreground">
                  {t('Read-aloud Piper attempt started', {
                    time: formatClock(snap.readAloudPiperTryStartedAt)
                  })}
                </p>
              ) : null}
              {!snap.readAloudPiperSkipped && snap.backend ? (
                <p className="break-all text-muted-foreground">
                  {t('Read-aloud Piper endpoint tried', { url: snap.backend })}
                </p>
              ) : null}
            </div>
          ) : null}
          {snap.engine === 'webspeech' && snap.usedPiperFallback ? (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
              role="status"
            >
              <p className="font-medium text-amber-950 dark:text-amber-100">
                {t('Read-aloud Piper fallback notice')}
              </p>
              {snap.piperFallbackDetail ? (
                <p className="mt-1.5 whitespace-pre-wrap break-words text-muted-foreground">
                  <span className="font-medium text-foreground/90">
                    {t('Read-aloud Piper fallback detail label')}:{' '}
                  </span>
                  {snap.piperFallbackDetail}
                </p>
              ) : null}
            </div>
          ) : null}
          {showChunks ? (
            <div className="space-y-2" role="region" aria-label={t('Read-aloud sections')}>
              <p className="text-xs text-muted-foreground">
                {t('Read-aloud section progress', {
                  current: snap.currentChunkIndex + 1,
                  total: snap.totalChunks
                })}
              </p>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(overallPct)}
                aria-label={t('Read-aloud overall progress')}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${overallPct}%` }}
                />
              </div>
              <div className="flex gap-1" role="list">
                {Array.from({ length: snap.totalChunks }, (_, i) => {
                  const done = i < snap.chunksPlayed
                  const active = i === snap.currentChunkIndex
                  const fetching = active && snap.phase === 'requesting'
                  const decoding = active && (snap.phase === 'buffering' || snap.phase === 'preparing')
                  const playing = active && snap.phase === 'playing'
                  const paused = active && snap.phase === 'paused'
                  return (
                    <div
                      key={i}
                      role="listitem"
                      className={cn(
                        'relative h-8 min-w-0 flex-1 overflow-hidden rounded-sm border border-border',
                        done && 'bg-primary',
                        !done && !active && 'bg-muted',
                        fetching && 'animate-pulse bg-amber-500/40',
                        decoding && !fetching && 'animate-pulse bg-amber-500/25',
                        (playing || paused) && !done && 'bg-muted'
                      )}
                      title={sectionAriaLabel(i, snap, t)}
                    >
                      {(playing || paused) && !done ? (
                        <div
                          className={cn(
                            'absolute inset-y-0 left-0 bg-primary/90',
                            paused && 'opacity-80'
                          )}
                          style={{
                            width: `${Math.round(Math.min(1, snap.chunkPlaybackRatio) * 100)}%`
                          }}
                        />
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] leading-tight text-muted-foreground">
                {snap.phase === 'requesting'
                  ? t('Read-aloud legend fetching')
                  : snap.phase === 'buffering' || snap.phase === 'preparing'
                    ? t('Read-aloud legend buffering')
                    : snap.phase === 'playing'
                      ? t('Read-aloud legend playing')
                      : snap.phase === 'paused'
                        ? t('Read-aloud legend paused')
                        : null}
              </p>
            </div>
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs border border-border rounded-md p-2 bg-muted/30">
            <dt className="text-muted-foreground">{t('Request sent')}</dt>
            <dd>{formatClock(snap.requestSentAt)}</dd>
            <dt className="text-muted-foreground">{t('Response received')}</dt>
            <dd>{formatClock(snap.responseReceivedAt)}</dd>
            <dt className="text-muted-foreground">{t('Playback started')}</dt>
            <dd>{formatClock(snap.playbackStartedAt)}</dd>
            <dt className="text-muted-foreground">{t('Characters')}</dt>
            <dd>{snap.charCount > 0 ? snap.charCount.toLocaleString() : '—'}</dd>
          </dl>
          {snap.error ? (
            <p className="text-xs text-destructive whitespace-pre-wrap break-words border border-destructive/30 rounded-md p-2 bg-destructive/5">
              {snap.error}
            </p>
          ) : null}
          <div className="flex justify-end pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => closeReadAloudPlayer()}>
              {t('Close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
