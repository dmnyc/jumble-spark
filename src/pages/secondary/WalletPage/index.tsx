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
import {
  SettingsGroup,
  SettingsPageContainer,
  SettingsRow
} from '@/components/ui/settings'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { toRizful, toSparkTest } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useSparkWallet } from '@/providers/SparkWalletProvider'
import { useZap } from '@/providers/ZapProvider'
import { disconnect, launchModal } from '@getalby/bitcoin-connect-react'
import { Plug, Sparkles, Unplug, Zap } from 'lucide-react'
import { forwardRef, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import DefaultZapAmountInput from './DefaultZapAmountInput'
import DefaultZapCommentInput from './DefaultZapCommentInput'
import LightningAddressInput from './LightningAddressInput'
import QuickZapSwitch from './QuickZapSwitch'

const WalletPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { isWalletConnected, walletInfo } = useZap()
  const { connected: sparkConnected, connecting: sparkConnecting } = useSparkWallet()
  const hasAutoNavigated = useRef(false)

  // Auto-navigate to Spark wallet if it's connected (only once on mount)
  useEffect(() => {
    if (sparkConnected && !isWalletConnected && !hasAutoNavigated.current) {
      console.log('[WalletPage] Spark wallet detected, navigating to Spark page')
      hasAutoNavigated.current = true
      push(toSparkTest())
    }
  }, [sparkConnected, isWalletConnected, push])

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Wallet')}>
      <SettingsPageContainer>
        {isWalletConnected ? (
          <>
            <SettingsGroup title={t('Connection')}>
              <SettingsRow
                icon={<Plug />}
                title={t('Connected wallet')}
                trailing={walletInfo?.node.alias ?? ''}
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <SettingsRow
                    icon={<Unplug />}
                    title={t('Disconnect Wallet')}
                    destructive
                    clickable
                    chevron
                  />
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
            </SettingsGroup>

            <SettingsGroup title={t('Zap defaults')}>
              <LightningAddressInput />
              <DefaultZapAmountInput />
              <DefaultZapCommentInput />
              <QuickZapSwitch />
            </SettingsGroup>
          </>
        ) : (
          <SettingsGroup title={t('Connect wallet')}>
            <SettingsRow
              icon={<img src="/spark-logo.svg" alt="Spark" className="size-5" />}
              title={
                sparkConnecting
                  ? t('Setting up Spark...')
                  : sparkConnected
                    ? t('Open Spark Wallet ✓')
                    : t('Try Breez SDK + Spark')
              }
              description={t('Self-custodial Lightning wallet powered by Breez SDK')}
              chevron
              onClick={() => push(toSparkTest())}
            />
            <SettingsRow
              icon={<Zap />}
              title={t('Connect wallet via NWC')}
              description={t('Use any NWC-compatible Lightning wallet')}
              chevron
              onClick={() => launchModal()}
            />
            <SettingsRow
              icon={<Sparkles />}
              title={t('Start with a Rizful Vault')}
              description={t('Quickly create a custodial Lightning vault')}
              chevron
              onClick={() => push(toRizful())}
            />
          </SettingsGroup>
        )}
      </SettingsPageContainer>
    </SecondaryPageLayout>
  )
})
WalletPage.displayName = 'WalletPage'
export default WalletPage
