import { Button } from '@/components/ui/button'
import { SettingsRow } from '@/components/ui/settings'
import { Switch } from '@/components/ui/switch'
import { isElectron } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { useUpdater } from '@/providers/UpdaterProvider'
import { Loader2, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function UpdateSettings() {
  const { t } = useTranslation()
  const { state, setAutoUpdate } = useUpdater()

  if (!isElectron()) return null

  const hasNewVersion = state.status === 'available' || state.status === 'downloaded'

  return (
    <>
      <SettingsRow
        htmlFor="auto-update"
        title={t('Automatic updates')}
        description={t('Check for and download updates in the background')}
        control={
          <Switch
            id="auto-update"
            checked={state.autoUpdateEnabled}
            onCheckedChange={(checked) => setAutoUpdate(checked)}
          />
        }
      />
      <SettingsRow
        title={
          <div className="flex items-center gap-2">
            {t('Check for updates')}
            {hasNewVersion && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium leading-none text-primary-foreground">
                {t('NEW')}
              </span>
            )}
          </div>
        }
        description={<UpdateStatusLine />}
        control={<UpdateActionButton />}
      />
    </>
  )
}

function UpdateStatusLine() {
  const { t } = useTranslation()
  const { state } = useUpdater()

  const version = `v${state.currentVersion}`

  switch (state.status) {
    case 'checking':
      return <>{t('Checking for updates…')}</>
    case 'available':
      return <>{t('Update available: v{{version}}', { version: state.newVersion ?? '' })}</>
    case 'not-available':
      return <>{t('You are on the latest version ({{version}})', { version })}</>
    case 'downloading':
      return (
        <>
          {t('Downloading update v{{version}}…', { version: state.newVersion ?? '' })}
          {typeof state.progressPercent === 'number' ? ` ${state.progressPercent}%` : null}
        </>
      )
    case 'downloaded':
      return <>{t('Update ready: v{{version}}', { version: state.newVersion ?? '' })}</>
    case 'error':
      return (
        <span className="text-destructive">
          {state.error ?? t('Failed to check for updates')}
        </span>
      )
    default:
      return <>{version}</>
  }
}

function UpdateActionButton() {
  const { t } = useTranslation()
  const { state, check, download, install } = useUpdater()
  const [localChecking, setLocalChecking] = useState(false)
  const prevStatusRef = useRef(state.status)

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = state.status
    if (prev !== 'checking') return
    if (state.status === 'not-available') {
      toast.success(
        t('You are on the latest version ({{version}})', { version: `v${state.currentVersion}` })
      )
    } else if (state.status === 'available') {
      toast.info(t('Update available: v{{version}}', { version: state.newVersion ?? '' }))
    } else if (state.status === 'error') {
      toast.error(state.error ?? t('Failed to check for updates'))
    }
  }, [state.status, state.currentVersion, state.newVersion, state.error, t])

  const handleCheck = async () => {
    setLocalChecking(true)
    try {
      await check()
    } finally {
      setLocalChecking(false)
    }
    if (!state.supported) {
      toast.info(t('Updates are not available in development mode'))
    }
  }

  if (state.status === 'downloaded') {
    return (
      <Button size="sm" onClick={install}>
        {t('Restart now')}
      </Button>
    )
  }

  if (state.status === 'available' && !state.autoUpdateEnabled) {
    return (
      <Button size="sm" onClick={download}>
        {t('Download')}
      </Button>
    )
  }

  if (state.status === 'downloading') {
    return (
      <Button size="sm" disabled>
        <Loader2 className="animate-spin" />
      </Button>
    )
  }

  const isChecking = localChecking || state.status === 'checking'
  return (
    <Button size="sm" variant="secondary" onClick={handleCheck} disabled={isChecking}>
      <RotateCw className={cn(isChecking && 'animate-spin')} />
      {t('Check')}
    </Button>
  )
}
