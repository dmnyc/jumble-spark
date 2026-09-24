import { cn } from '@/lib/utils'
import { useUpdater } from '@/providers/UpdaterProvider'
import { Download, Power, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function UpdateButton({ collapse }: { collapse: boolean }) {
  const { t } = useTranslation()
  const { state, download, install } = useUpdater()

  if (!state.supported) return null
  if (!['downloaded', 'downloading', 'download-error'].includes(state.status)) return null

  const isDownloading = state.status === 'downloading'
  const isDownloadError = state.status === 'download-error'
  const fullLabel = isDownloadError
    ? `${t('Try again later or check your connection')}${state.error ? `: ${state.error}` : ''}`
    : isDownloading
      ? t('Downloading update v{{version}}…', { version: state.newVersion ?? '' })
      : t('Update ready: v{{version}}', { version: state.newVersion ?? '' })

  const baseClasses =
    'cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-70 [&_svg]:size-5 [&_svg]:shrink-0'

  const handleClick = () => {
    if (isDownloadError) {
      download()
    } else if (!isDownloading) {
      install()
    }
  }

  if (collapse) {
    return (
      <button
        type="button"
        disabled={isDownloading}
        title={fullLabel}
        className={cn(
          baseClasses,
          'relative flex size-12 items-center justify-center overflow-hidden rounded-lg border',
          isDownloadError
            ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15'
            : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
        )}
        onClick={handleClick}
      >
        {(isDownloading || isDownloadError) && (
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 transition-[height] duration-300',
              isDownloadError ? 'bg-destructive/20' : 'bg-primary/30'
            )}
            style={{ height: `${state.progressPercent ?? 0}%` }}
          />
        )}
        <div className="relative">
          {isDownloadError ? <TriangleAlert /> : isDownloading ? <Download /> : <Power />}
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={isDownloading}
      title={fullLabel}
      className={cn(
        baseClasses,
        'relative flex w-full items-center gap-3 overflow-hidden rounded-lg border px-3 py-2 text-start',
        isDownloadError
          ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15'
          : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
      )}
      onClick={handleClick}
    >
      {(isDownloading || isDownloadError) && (
        <div
          className={cn(
            'absolute inset-y-0 start-0 transition-[width] duration-300',
            isDownloadError ? 'bg-destructive/20' : 'bg-primary/30'
          )}
          style={{ width: `${state.progressPercent ?? 0}%` }}
        />
      )}
      <div className="relative flex min-w-0 flex-1 items-center gap-3">
        {isDownloadError ? <TriangleAlert /> : isDownloading ? <Download /> : <Power />}
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <div className="truncate text-xs leading-tight font-medium">{`v${state.newVersion ?? ''}`}</div>
          <div className="text-[11px] leading-tight opacity-80">
            {isDownloadError
              ? t('Retry')
              : isDownloading
                ? `${state.progressPercent ?? 0}%`
                : t('Restart now')}
          </div>
        </div>
      </div>
    </button>
  )
}
