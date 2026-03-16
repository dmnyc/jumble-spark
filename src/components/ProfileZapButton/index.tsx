import { Button } from '@/components/ui/button'
import { useNostr } from '@/providers/NostrProvider'
import { Zap } from 'lucide-react'
import { useState } from 'react'
import ZapDialog from '../ZapDialog'

export default function ProfileZapButton({
  pubkey,
  openZapDialog,
  setOpenZapDialog
}: {
  pubkey: string
  openZapDialog?: boolean
  setOpenZapDialog?: (open: boolean) => void
}) {
  const { checkLogin } = useNostr()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = setOpenZapDialog ? (openZapDialog ?? false) : internalOpen
  const setOpen = setOpenZapDialog ?? setInternalOpen

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        className="rounded-full"
        onClick={() => checkLogin(() => setOpen(true))}
      >
        <Zap className="text-yellow-400" />
      </Button>
      {!setOpenZapDialog && <ZapDialog open={open} setOpen={setInternalOpen} pubkey={pubkey} />}
    </>
  )
}
