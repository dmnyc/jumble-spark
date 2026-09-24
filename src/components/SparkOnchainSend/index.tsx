import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  EMPTY_STABLE_BALANCE,
  formatTokenAmount,
  getOnchainFeeSats,
  USDB_LABEL,
  USDB_TOKEN_IDENTIFIER
} from '@/lib/spark-payment'
import sparkService from '@/services/spark.service'
import type {
  ConversionEstimate,
  OnchainConfirmationSpeed,
  PrepareSendPaymentResponse,
  SendOnchainFeeQuote
} from '@breeztech/breez-sdk-spark/web'
import { Loader2 } from 'lucide-react'
import { ReactNode, useEffect, useState } from 'react'
import { toast } from 'sonner'

const SPEEDS: { value: OnchainConfirmationSpeed; label: string }[] = [
  { value: 'slow', label: 'Slow' },
  { value: 'medium', label: 'Medium' },
  { value: 'fast', label: 'Fast' }
]

export function getFeeQuote(prepared: PrepareSendPaymentResponse | null | undefined) {
  return prepared?.paymentMethod.type === 'bitcoinAddress' ? prepared.paymentMethod.feeQuote : null
}

/** "$12.34 USDB → ~20,339 sats" for a payment funded by converting USDB */
export function describeUsdbConversion(estimate: ConversionEstimate): string | null {
  const { conversionType } = estimate.options
  if (
    conversionType.type !== 'toBitcoin' ||
    conversionType.fromTokenIdentifier !== USDB_TOKEN_IDENTIFIER
  ) {
    return null
  }
  const usdb = formatTokenAmount({
    ticker: USDB_LABEL,
    amount: estimate.amountIn.toString(),
    decimals: EMPTY_STABLE_BALANCE.decimals
  })
  return `${usdb} → ~${Number(estimate.amountOut).toLocaleString()} sats`
}

export function DetailRow({
  label,
  value,
  bold = false
}: {
  label: string
  value: ReactNode
  bold?: boolean
}) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 text-right">{value}</span>
    </div>
  )
}

export function OnchainFeePicker({
  quote,
  speed,
  onChange
}: {
  quote: SendOnchainFeeQuote
  speed: OnchainConfirmationSpeed
  onChange: (speed: OnchainConfirmationSpeed) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">Network fee{quote.isEstimate && ' (estimated)'}</Label>
      <div className="grid grid-cols-3 gap-2">
        {SPEEDS.map(({ value, label }) => (
          <Button
            key={value}
            type="button"
            variant={speed === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(value)}
            className="flex h-auto flex-col gap-0.5 py-2"
          >
            <span className="text-xs font-semibold">{label}</span>
            <span className="text-xs">{getOnchainFeeSats(quote, value).toLocaleString()} sats</span>
          </Button>
        ))}
      </div>
      {quote.isEstimate && (
        <p className="text-muted-foreground text-xs">
          Your USD balance funds this payment, so the fee is an upper bound until the conversion
          completes.
        </p>
      )}
    </div>
  )
}

/**
 * Send to a Bitcoin address: enter an amount, review the fee quotes, then
 * confirm against the full address before anything is sent.
 */
export default function SparkOnchainSend({
  address,
  onSent
}: {
  address: string
  onSent: () => void
}) {
  const [amount, setAmount] = useState(0)
  const [preparing, setPreparing] = useState(false)
  const [prepared, setPrepared] = useState<PrepareSendPaymentResponse | null>(null)
  const [speed, setSpeed] = useState<OnchainConfirmationSpeed>('medium')
  const [sending, setSending] = useState(false)

  // A quote only fits the address and amount it was prepared for
  useEffect(() => setPrepared(null), [address, amount])

  const quote = getFeeQuote(prepared)
  const fee = quote ? getOnchainFeeSats(quote, speed) : 0
  const conversion = prepared?.conversionEstimate
    ? describeUsdbConversion(prepared.conversionEstimate)
    : null

  const handleReview = async () => {
    setPreparing(true)
    try {
      setPrepared(await sparkService.prepareOnchainSend(address, amount))
    } catch (error) {
      toast.error(`Couldn't prepare the payment: ${(error as Error).message}`)
    } finally {
      setPreparing(false)
    }
  }

  const handleSend = async () => {
    if (!prepared) return
    setSending(true)
    try {
      await sparkService.sendOnchain(prepared, speed)
      toast.success(`Sent ${amount.toLocaleString()} sats on-chain`)
      setAmount(0)
      onSent()
    } catch (error) {
      toast.error(`On-chain payment failed: ${(error as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-muted-foreground text-xs">
        On-chain Bitcoin payment. On-chain payments can&apos;t be reversed, so check the address
        before sending.
      </p>
      <div className="space-y-2">
        <Label htmlFor="onchainAmount" className="text-xs">
          Amount (sats) <span className="text-red-500">*</span>
        </Label>
        <Input
          id="onchainAmount"
          type="number"
          placeholder="Enter amount in sats"
          value={amount || ''}
          onChange={(e) => setAmount(Number(e.target.value))}
          min="1"
        />
      </div>

      {!quote ? (
        <Button onClick={handleReview} disabled={preparing || amount <= 0} className="w-full">
          {preparing && <Loader2 className="animate-spin" />}
          Review payment
        </Button>
      ) : (
        <>
          <OnchainFeePicker quote={quote} speed={speed} onChange={setSpeed} />
          <div className="bg-muted space-y-1 rounded-md p-2 text-xs">
            <DetailRow label="To" value={<span className="font-mono break-all">{address}</span>} />
            <DetailRow label="Amount" value={`${amount.toLocaleString()} sats`} />
            <DetailRow label="Network fee" value={`${fee.toLocaleString()} sats`} />
            {conversion && <DetailRow label="From USD balance" value={conversion} />}
            <DetailRow label="Total" value={`${(amount + fee).toLocaleString()} sats`} bold />
          </div>
          <Button onClick={handleSend} disabled={sending} className="w-full">
            {sending && <Loader2 className="animate-spin" />}
            Send {(amount + fee).toLocaleString()} sats
          </Button>
        </>
      )}
    </div>
  )
}
