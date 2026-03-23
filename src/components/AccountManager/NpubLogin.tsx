import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { useNostr } from '@/providers/NostrProvider'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function NpubLogin({
  back,
  onLoginSuccess
}: {
  back: () => void
  onLoginSuccess: () => void
}) {
  const { t } = useTranslation()
  const { npubLogin } = useNostr()
  const [pending, setPending] = useState(false)
  const [npubInput, setNpubInput] = useState('')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNpubInput(e.target.value)
    setErrMsg(null)
  }

  const handleLogin = () => {
    if (npubInput === '') return

    setPending(true)
    npubLogin(npubInput)
      .then(() => onLoginSuccess())
      .catch((err) => setErrMsg(err.message))
      .finally(() => setPending(false))
  }

  return (
    <>
      <div className="space-y-1">
        <Input
          placeholder="npub..."
          value={npubInput}
          onChange={handleInputChange}
          className={errMsg ? 'border-destructive' : ''}
        />
        {errMsg && <div className="text-xs text-destructive pl-3">{errMsg}</div>}
      </div>
      <Button onClick={handleLogin} disabled={pending}>
        {pending && <Skeleton className="mr-2 inline-block size-4 shrink-0 rounded-full align-middle" aria-hidden />}
        {t('Login')}
      </Button>
      <Button variant="secondary" onClick={back}>
        {t('Back')}
      </Button>
    </>
  )
}
