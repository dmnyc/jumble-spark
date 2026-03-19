import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function NewMailboxRelayInput({
  saveNewMailboxRelay
}: {
  saveNewMailboxRelay: (url: string) => string | null
}) {
  const { t } = useTranslation()
  const [newRelayUrl, setNewRelayUrl] = useState('')
  const [newRelayUrlError, setNewRelayUrlError] = useState<string | null>(null)

  const save = () => {
    const error = saveNewMailboxRelay(newRelayUrl)
    if (error) {
      setNewRelayUrlError(error)
    } else {
      setNewRelayUrl('')
    }
  }

  const handleRelayUrlInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
    }
  }

  const handleRelayUrlInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewRelayUrl(e.target.value)
    setNewRelayUrlError(null)
  }

  return (
    <div className="min-w-0">
      {/* flex-wrap: narrow panes (e.g. double-pane) use viewport breakpoints, not container width */}
      <div className="flex flex-wrap gap-2">
        <Input
          className={`min-w-0 flex-1 basis-[min(100%,16rem)] ${newRelayUrlError ? 'border-destructive' : ''}`}
          placeholder={t('Add a new relay')}
          value={newRelayUrl}
          onKeyDown={handleRelayUrlInputKeyDown}
          onChange={handleRelayUrlInputChange}
          onBlur={save}
        />
        <Button className="shrink-0" onClick={save}>
          {t('Add')}
        </Button>
      </div>
      {newRelayUrlError && <div className="text-destructive text-xs mt-1">{newRelayUrlError}</div>}
    </div>
  )
}
