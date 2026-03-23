import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useZap } from '@/providers/ZapProvider'
import { disconnect, launchModal } from '@getalby/bitcoin-connect-react'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DefaultZapAmountInput from './DefaultZapAmountInput'
import DefaultZapCommentInput from './DefaultZapCommentInput'
import LightningAddressInput from './LightningAddressInput'
import QuickZapSwitch from './QuickZapSwitch'
import ZapReplyThresholdInput from './ZapReplyThresholdInput'

const WalletPage = forwardRef(({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const [contentKey, setContentKey] = useState(0)
  const bump = useCallback(() => setContentKey((k) => k + 1), [])
  const { isWalletConnected, walletInfo } = useZap()

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(bump)
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, bump])

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={hideTitlebar ? undefined : t('Wallet')}
      controls={hideTitlebar ? undefined : <RefreshButton onClick={bump} />}
    >
      <div key={contentKey} className="px-4 pt-3 space-y-4">
        {isWalletConnected ? (
          <>
            <div>
              {walletInfo?.node.alias && (
                <div className="mb-2">
                  {t('Connected to')} <strong>{walletInfo.node.alias}</strong>
                </div>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">{t('Disconnect Wallet')}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('Are you absolutely sure?')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('You will not be able to send zaps to others.')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => disconnect()}>
                      {t('Disconnect')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <DefaultZapAmountInput />
            <DefaultZapCommentInput />
            <QuickZapSwitch />
            <LightningAddressInput />
          </>
        ) : (
          <div>
            <Button
              className="bg-foreground hover:bg-foreground/90"
              onClick={() => {
                launchModal()
              }}
            >
              {t('Connect Wallet')}
            </Button>
          </div>
        )}
        
        {/* Zap Reply Threshold - always visible as it's just a display setting */}
        <ZapReplyThresholdInput />
      </div>
    </SecondaryPageLayout>
  )
})
WalletPage.displayName = 'WalletPage'
export default WalletPage
