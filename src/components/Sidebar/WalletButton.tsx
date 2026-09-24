import { Button } from '@/components/ui/button'
import { toWallet } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { useSparkWallet } from '@/providers/SparkWalletProvider'
import { useZap } from '@/providers/ZapProvider'
import sparkStorage from '@/services/spark-storage.service'
import { useCurrencyPreferences } from '@/providers/CurrencyPreferencesProvider'
import { useCurrencyConversion } from '@/hooks/useCurrencyConversion'
import { formatFiatAmount } from '@/lib/currency'
import { formatStableBalance } from '@/lib/spark-payment'
import { cn } from '@/lib/utils'
import { Eye, EyeOff, Wallet } from 'lucide-react'

export default function WalletButton({ collapse }: { collapse: boolean }) {
  const { push } = useSecondaryPage()
  const { pubkey } = useNostr()
  const { connected, connecting, balance, balanceLoading, stableBalance } = useSparkWallet()
  const { isWalletConnected } = useZap()
  const { displayCurrency, isBalanceHidden, toggleBalanceVisibility } = useCurrencyPreferences()
  const { fiatValue, isLoading } = useCurrencyConversion(balance || 0, displayCurrency)

  // Wallets belong to an account; logged-out visitors get the Login button instead
  if (!pubkey) return null

  // A saved Spark wallet counts while it auto-connects, so the setup prompt
  // doesn't flash before its balance loads
  const hasSparkWallet = connected || connecting || sparkStorage.hasMnemonic(pubkey)
  // An NWC wallet is a connected wallet too; the sidebar only shows Spark balances
  if (!hasSparkWallet && isWalletConnected) return null
  const needsSetup = !hasSparkWallet

  const balanceSats = balance || 0
  // Mirror the wallet page: USDB leads once the stable balance is on, or while any is held
  const showStableBalance = stableBalance.active || stableBalance.balance > 0n

  const handleWalletClick = () => {
    push(toWallet())
  }

  const toggleHideBalance = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleBalanceVisibility()
  }

  if (collapse) {
    return (
      <Button
        variant="ghost"
        onClick={handleWalletClick}
        className="w-12 h-12 p-2 flex items-center justify-center bg-transparent text-foreground hover:text-accent-foreground rounded-lg shadow-none"
        title={needsSetup ? 'Set up wallet' : 'Wallet'}
      >
        <Wallet className="size-5" />
      </Button>
    )
  }

  if (needsSetup) {
    return (
      <Button
        variant="ghost"
        onClick={handleWalletClick}
        className="w-full h-auto p-3 flex items-center justify-start gap-2 bg-muted/50 hover:bg-muted rounded-lg shadow-none"
      >
        <Wallet className="size-4" />
        <span className="text-sm font-medium">Set up wallet</span>
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      onClick={handleWalletClick}
      className="w-full h-auto p-3 flex flex-col items-start bg-muted/50 hover:bg-muted rounded-lg shadow-none gap-1"
    >
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <Wallet className="size-4" />
          <span className="text-xs font-medium text-muted-foreground">Wallet</span>
        </div>
        <button
          onClick={toggleHideBalance}
          className="p-1 hover:bg-background rounded transition-colors"
          title={isBalanceHidden ? 'Show balance' : 'Hide balance'}
        >
          {isBalanceHidden ? (
            <Eye className="size-3.5 text-muted-foreground" />
          ) : (
            <EyeOff className="size-3.5 text-muted-foreground" />
          )}
        </button>
      </div>
      <div className={cn('flex flex-col items-start w-full', balanceLoading && 'animate-pulse')}>
        {isBalanceHidden ? (
          <span className="text-lg font-bold">••••</span>
        ) : !connected && !balanceLoading ? (
          <span className="text-sm text-muted-foreground">Not connected</span>
        ) : balanceLoading && !balance && !stableBalance.balance ? (
          <span className="text-lg font-bold">Loading</span>
        ) : showStableBalance ? (
          <>
            <span className="text-lg font-bold">
              ${formatStableBalance(stableBalance.balance, stableBalance.decimals)}{' '}
              {stableBalance.label}
            </span>
            {balanceSats > 0 && (
              <span className="text-xs text-muted-foreground">
                + {balanceSats.toLocaleString()} sats
              </span>
            )}
          </>
        ) : (
          <>
            {displayCurrency === 'SATS' ? (
              <span className="text-lg font-bold">{balanceSats.toLocaleString()} sats</span>
            ) : isLoading || fiatValue === null ? (
              <span className="text-lg font-bold">...</span>
            ) : (
              <>
                <span className="text-lg font-bold">{formatFiatAmount(fiatValue, displayCurrency)}</span>
                <span className="text-xs text-muted-foreground">{balanceSats.toLocaleString()} sats</span>
              </>
            )}
          </>
        )}
      </div>
    </Button>
  )
}
