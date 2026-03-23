import { Button } from '@/components/ui/button'
import { DESKTOP_APP_DOWNLOAD_URL_DEFAULT } from '@/constants'
import { cn } from '@/lib/utils'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function resolveDesktopDownloadUrl(): string | null {
  if (typeof window === 'undefined') return DESKTOP_APP_DOWNLOAD_URL_DEFAULT
  const fromConfig = window.__RUNTIME_CONFIG__?.DESKTOP_DOWNLOAD_URL
  if (fromConfig !== undefined) {
    const trimmed = fromConfig.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return DESKTOP_APP_DOWNLOAD_URL_DEFAULT
}

/** Bottom-of-sidebar link to native (Electron) builds; hidden in the packaged app and when URL is disabled. */
export default function DownloadDesktopSidebarButton() {
  const { t } = useTranslation()
  if (typeof window !== 'undefined' && window.jumbleElectron?.isElectron) {
    return null
  }
  const href = resolveDesktopDownloadUrl()
  if (!href) return null

  return (
    <Button
      variant="ghost"
      className={cn(
        'flex shadow-none items-center transition-colors duration-500 bg-transparent w-12 h-12 xl:w-full xl:h-auto xl:min-w-0 p-3 m-0 xl:py-2 xl:pl-3 xl:pr-4 rounded-lg xl:justify-start gap-3 text-lg font-semibold [&_svg]:size-full xl:[&_svg]:size-4 xl:[&_svg]:shrink-0',
        'text-muted-foreground hover:text-foreground'
      )}
      asChild
    >
      <a href={href} target="_blank" rel="noopener noreferrer" title={t('downloadDesktopApp')}>
        <Download strokeWidth={2.5} aria-hidden />
        <div className="max-xl:hidden min-w-0 flex-1 text-left break-words leading-snug pr-0.5">
          {t('downloadDesktopApp')}
        </div>
      </a>
    </Button>
  )
}
