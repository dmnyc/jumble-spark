import { normalizeUrl } from '@/lib/url'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { Input } from '../ui/input'
import { Check } from 'lucide-react'
import logger from '@/lib/logger'

export default function AddBlockedRelay() {
  const { t } = useTranslation()
  const { blockedRelays, addBlockedRelays } = useFavoriteRelays()
  const [input, setInput] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const saveRelay = async () => {
    if (!input || isLoading) return
    const normalizedUrl = normalizeUrl(input)
    if (!normalizedUrl) {
      setErrorMsg(t('Invalid URL'))
      setSuccessMsg('')
      return
    }
    if (blockedRelays.includes(normalizedUrl)) {
      setErrorMsg(t('Already blocked'))
      setSuccessMsg('')
      return
    }

    setIsLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      await addBlockedRelays([normalizedUrl])
      setInput('')
      setSuccessMsg(t('Relay blocked successfully'))
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (error) {
      logger.error('Failed to block relay', { error, relay: normalizedUrl })
      setErrorMsg(t('Failed to block relay. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleNewRelayInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
    setErrorMsg('')
    setSuccessMsg('')
  }

  const handleNewRelayInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveRelay()
    }
  }

  return (
    <div className="space-y-1">
      <div className="text-muted-foreground font-semibold select-none">{t('Block Relay')}</div>
      <div className="flex gap-2 items-center">
        <Input
          placeholder={t('Add a relay to block')}
          value={input}
          onChange={handleNewRelayInputChange}
          onKeyDown={handleNewRelayInputKeyDown}
          className={errorMsg ? 'border-destructive' : successMsg ? 'border-green-500' : ''}
          disabled={isLoading}
        />
        <Button onClick={saveRelay} disabled={isLoading || !input.trim()}>
          {isLoading ? (
            <>
              <Skeleton className="mr-2 size-4 shrink-0 rounded-sm" aria-hidden />
              {t('Blocking...')}
            </>
          ) : (
            t('Block')
          )}
        </Button>
      </div>
      {errorMsg && <div className="text-destructive text-sm pl-8">{errorMsg}</div>}
      {successMsg && (
        <div className="text-green-600 dark:text-green-400 text-sm pl-8 flex items-center gap-1">
          <Check className="h-3 w-3" />
          {successMsg}
        </div>
      )}
    </div>
  )
}

