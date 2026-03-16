import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getPaytoTypeInfo } from '@/lib/payto'
import { Zap } from 'lucide-react'

export default function PaytoDialog({
  open,
  onOpenChange,
  type,
  authority,
  paytoUri
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: string
  authority: string
  paytoUri: string
}) {
  const { t } = useTranslation()
  const info = getPaytoTypeInfo(type)
  const label = info?.label ?? type
  const isLightning = type.toLowerCase() === 'lightning'

  const handleCopy = (text: string, label?: string) => {
    navigator.clipboard.writeText(text)
    toast.success(label ? t('Copied {{label}} address', { label }) : t('Copied to clipboard'))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isLightning && <Zap className="size-5 text-yellow-400" />}
            <span>{label}</span>
          </DialogTitle>
          <DialogDescription>
            {isLightning
              ? t('Lightning payment address – copy to pay via your wallet')
              : t('Payment address – copy to use in your wallet or app')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all select-text">
            {authority}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleCopy(authority, label)}
              className="gap-2"
            >
              <Copy className="size-4" />
              {t('Copy address')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCopy(paytoUri)}
              className="gap-2"
            >
              <Copy className="size-4" />
              {t('Copy payto URI')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
