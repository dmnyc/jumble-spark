import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { WrapText, Copy, Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import logger from '@/lib/logger'

export default function JsonViewDialog({
  title,
  value,
  isOpen,
  onClose
}: {
  title?: string
  value: unknown
  isOpen: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [wordWrapEnabled, setWordWrapEnabled] = useState(true)
  const [copied, setCopied] = useState(false)

  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2)
    } catch (e) {
      return String(e)
    }
  }, [value])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      logger.error('Failed to copy JSON view', { error: err })
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[60vh] w-[95vw] max-w-[400px] sm:w-[90vw] sm:max-w-[600px] md:w-[85vw] md:max-w-[800px] lg:w-[80vw] lg:max-w-[1000px] xl:w-[75vw] xl:max-w-[1200px] 2xl:w-[70vw] 2xl:max-w-[1400px] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-8">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <DialogTitle>{title ?? t('View JSON')}</DialogTitle>
              <DialogDescription className="sr-only">{t('View JSON')}</DialogDescription>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                title={copied ? t('Copied!') : t('Copy to clipboard')}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWordWrapEnabled(!wordWrapEnabled)}
                title={wordWrapEnabled ? t('Disable word wrap') : t('Enable word wrap')}
              >
                <WrapText className={`h-4 w-4 ${wordWrapEnabled ? '' : 'opacity-50'}`} />
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
          <ScrollArea className="h-full w-full">
            <div className="w-full min-w-0 max-w-full pr-4">
              <pre
                className={`text-sm text-muted-foreground select-text min-w-0 ${wordWrapEnabled ? 'whitespace-pre-wrap overflow-x-hidden' : 'whitespace-pre overflow-x-auto'}`}
                style={{
                  wordBreak: wordWrapEnabled ? 'break-all' : 'normal',
                  overflowWrap: wordWrapEnabled ? 'anywhere' : 'normal',
                  maxWidth: '100%',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                {text}
              </pre>
            </div>
            <ScrollBar
              orientation="horizontal"
              className={wordWrapEnabled ? 'opacity-0 pointer-events-none' : ''}
            />
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
