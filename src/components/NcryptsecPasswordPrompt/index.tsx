import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  open: boolean
  onResult: (password: string | null) => void
}

export default function NcryptsecPasswordPrompt({ open, onResult }: Props) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (open) setPassword('')
  }, [open])

  const title = t('Enter the password to decrypt your ncryptsec')

  const submit = () => {
    const trimmed = password.trim()
    onResult(trimmed.length > 0 ? trimmed : null)
  }

  const cancel = () => {
    onResult(null)
  }

  const form = (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="ncryptsec-unlock-password">{t('password')}</Label>
        <Input
          id="ncryptsec-unlock-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={cancel}>
          {t('Cancel')}
        </Button>
        <Button type="submit">{t('Continue')}</Button>
      </div>
    </form>
  )

  if (isSmallScreen) {
    return (
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next) cancel()
        }}
      >
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription className="sr-only">{title}</DrawerDescription>
          </DrawerHeader>
          <div className="p-4 pt-0">{form}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) cancel()
      }}
    >
      <DialogContent className="w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  )
}
