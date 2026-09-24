import {
  describeUsdbConversion,
  DetailRow,
  getFeeQuote,
  OnchainFeePicker
} from '@/components/SparkOnchainSend'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  EMPTY_STABLE_BALANCE,
  formatTokenAmount,
  getOnchainFeeSats,
  normalizeBitcoinAddress,
  USDB_LABEL
} from '@/lib/spark-payment'
import { useSparkWallet } from '@/providers/SparkWalletProvider'
import sparkService, { TDrainPreparation } from '@/services/spark.service'
import type { OnchainConfirmationSpeed } from '@breeztech/breez-sdk-spark/web'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

/**
 * Send the entire balance, Bitcoin plus any USD balance converted to Bitcoin,
 * to an on-chain address. Fees come out of the total.
 */
export default function SparkDrainWallet({ onDrained }: { onDrained: () => void }) {
  const { balance, stableBalance } = useSparkWallet()
  const [input, setInput] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [preparation, setPreparation] = useState<TDrainPreparation | null>(null)
  const [speed, setSpeed] = useState<OnchainConfirmationSpeed>('medium')
  const [verified, setVerified] = useState(false)
  const [sending, setSending] = useState(false)

  const address = normalizeBitcoinAddress(input)
  const isEmpty = !balance && !stableBalance.balance

  // A quote only fits the address it was prepared for
  useEffect(() => {
    setPreparation(null)
    setVerified(false)
  }, [input])

  const prepared = preparation?.prepareResponse
  const quote = getFeeQuote(prepared)
  const conversion = prepared?.conversionEstimate
    ? describeUsdbConversion(prepared.conversionEstimate)
    : null
  // With fees included, the prepared amount is the whole balance in sats
  // (after any conversion) and the network fee comes out of it
  const totalSats = prepared ? Number(prepared.amount) : 0
  const fee = quote ? getOnchainFeeSats(quote, speed) : 0
  const recipientSats = Math.max(totalSats - fee, 0)
  const leftoverUsdb = preparation?.leftoverUsdb ?? 0n

  const handleReview = async () => {
    if (!address) return
    setPreparing(true)
    try {
      setPreparation(await sparkService.prepareDrainWallet(address))
    } catch (error) {
      toast.error(`Couldn't prepare the drain: ${(error as Error).message}`)
    } finally {
      setPreparing(false)
    }
  }

  const handleSend = async () => {
    if (!prepared) return
    setSending(true)
    try {
      await sparkService.sendOnchain(prepared, speed)
      toast.success(`Wallet drain sent: ${recipientSats.toLocaleString()} sats on the way`)
      setInput('')
      onDrained()
    } catch (error) {
      toast.error(`Drain failed: ${(error as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-2 border-t pt-2">
      <Label className="text-sm">Drain Wallet</Label>
      <p className="text-muted-foreground text-xs">
        Send everything in this wallet, your Bitcoin plus any USD balance converted to Bitcoin, to
        an on-chain address. Network and conversion fees come out of the total.
      </p>
      <Input
        placeholder="Bitcoin address"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={sending}
      />
      {input.trim() && !address && (
        <p className="text-xs text-red-500">Enter a valid Bitcoin address</p>
      )}

      {!quote ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleReview}
            disabled={!address || preparing || isEmpty}
          >
            {preparing && <Loader2 className="animate-spin" />}
            Review drain
          </Button>
          {isEmpty && <p className="text-muted-foreground text-xs">The wallet is empty.</p>}
        </>
      ) : (
        <div className="border-destructive/50 space-y-3 rounded-lg border p-3">
          <OnchainFeePicker quote={quote} speed={speed} onChange={setSpeed} />
          <div className="bg-muted space-y-1 rounded-md p-2 text-xs">
            <DetailRow label="To" value={<span className="font-mono break-all">{address}</span>} />
            {conversion && <DetailRow label="USD balance" value={conversion} />}
            <DetailRow label="Total balance" value={`${totalSats.toLocaleString()} sats`} />
            <DetailRow label="Network fee" value={`−${fee.toLocaleString()} sats`} />
            <DetailRow
              label="Recipient gets"
              value={`${conversion ? '≈ ' : ''}${recipientSats.toLocaleString()} sats`}
              bold
            />
          </div>
          {leftoverUsdb > 0n && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {formatTokenAmount({
                ticker: USDB_LABEL,
                amount: leftoverUsdb.toString(),
                decimals: EMPTY_STABLE_BALANCE.decimals
              })}{' '}
              is below the minimum that can be converted to Bitcoin, so it stays in the wallet.
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <Checkbox
              checked={verified}
              onCheckedChange={(checked) => setVerified(checked === true)}
              className="mt-0.5"
            />
            <span>
              I&apos;ve checked the address. This sends the entire balance and can&apos;t be
              reversed.
            </span>
          </label>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setPreparation(null)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="flex-1"
              onClick={handleSend}
              disabled={!verified || sending}
            >
              {sending && <Loader2 className="animate-spin" />}
              Send entire balance
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
