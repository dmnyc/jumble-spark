import { useSecondaryPage } from '@/PageManager'
import { toSparkTest } from '@/lib/link'
import { formatStableBalance } from '@/lib/spark-payment'
import { cn } from '@/lib/utils'
import { useSparkWallet } from '@/providers/SparkWalletProvider'
import { useZap } from '@/providers/ZapProvider'
import { Wallet, Zap } from 'lucide-react'
import { Button } from '../ui/button'

/**
 * SparkWalletBalance - Display Spark wallet balance in header
 *
 * Shows balance when Spark wallet is connected
 * Clicking opens the Spark wallet page
 */
export function SparkWalletBalance() {
  const { isSparkConnected, sparkWalletInfo } = useZap()
  const { balanceLoading, stableBalance } = useSparkWallet()
  const { push } = useSecondaryPage()

  if (!isSparkConnected || !sparkWalletInfo) {
    return null
  }

  const balanceSats = sparkWalletInfo.balanceSats || 0
  const showStableBalance = stableBalance.active || stableBalance.balance > 0n
  const showLoading = balanceLoading && !balanceSats && !stableBalance.balance

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-2 h-8 px-2 text-xs"
      onClick={() => push(toSparkTest())}
      title="Open Spark wallet"
    >
      <Wallet className="size-4" />
      <span className={cn('font-mono font-semibold', balanceLoading && 'animate-pulse')}>
        {showLoading
          ? 'Loading'
          : showStableBalance
            ? `$${formatStableBalance(stableBalance.balance, stableBalance.decimals)} ${stableBalance.label}`
            : balanceSats.toLocaleString()}
      </span>
      {!showStableBalance && !showLoading && <Zap className="size-3 text-yellow-500" />}
    </Button>
  )
}
