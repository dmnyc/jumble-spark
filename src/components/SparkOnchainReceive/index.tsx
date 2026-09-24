import { DetailRow } from '@/components/SparkOnchainSend'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getDepositStatus, normalizeBitcoinAddress } from '@/lib/spark-payment'
import { useSparkWallet } from '@/providers/SparkWalletProvider'
import sparkService from '@/services/spark.service'
import type {
  ClaimDepositQuote,
  DepositInfo,
  RecommendedFees
} from '@breeztech/breez-sdk-spark/web'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import QRCodeStyling from 'qr-code-styling'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

const REFUND_SPEEDS = [
  { name: 'Slow', fee: 'hourFee' },
  { name: 'Medium', fee: 'halfHourFee' },
  { name: 'Fast', fee: 'fastestFee' }
] as const satisfies readonly { name: string; fee: keyof RecommendedFees }[]

const txUrl = (txid: string) => `https://mempool.space/tx/${txid}`
const shortTxid = (txid: string) => `${txid.slice(0, 8)}…${txid.slice(-8)}`

/** Receive on-chain: the wallet's Bitcoin address, plus the deposits it has seen. */
export default function SparkOnchainReceive() {
  const { unclaimedDeposits, refreshDeposits, refreshWalletState } = useSparkWallet()
  const [address, setAddress] = useState<string | null>(null)
  const qrRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sparkService
      .getBitcoinAddress()
      .then(setAddress)
      .catch((error) => toast.error(`Couldn't get a Bitcoin address: ${error.message}`))
    refreshDeposits()
  }, [])

  useEffect(() => {
    if (!address || !qrRef.current) return
    qrRef.current.innerHTML = ''
    const size = Math.min((qrRef.current.parentElement?.clientWidth || 300) - 32, 280)
    new QRCodeStyling({
      width: size,
      height: size,
      data: `bitcoin:${address}`.toUpperCase(),
      margin: 10,
      qrOptions: { typeNumber: 0, mode: 'Byte', errorCorrectionLevel: 'M' },
      dotsOptions: { color: '#000000', type: 'rounded' },
      backgroundOptions: { color: '#ffffff' },
      cornersSquareOptions: { color: '#000000', type: 'extra-rounded' },
      cornersDotOptions: { color: '#000000', type: 'dot' }
    }).append(qrRef.current)
  }, [address])

  const handleSettled = () => {
    refreshDeposits()
    refreshWalletState()
  }

  return (
    <div className="space-y-4">
      {address ? (
        <>
          <div className="flex justify-center">
            <div ref={qrRef} className="overflow-hidden rounded-lg" />
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-muted flex-1 rounded p-2 font-mono text-xs break-all">{address}</div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(address)
                toast.success('Bitcoin address copied')
              }}
              title="Copy Bitcoin address"
            >
              <Copy />
            </Button>
          </div>
        </>
      ) : (
        <div className="flex justify-center py-8">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Send only bitcoin (BTC) on the Bitcoin network. Deposits are credited after 3 confirmations.
        If the network fee to claim a deposit is high, you&apos;ll be asked to approve it here.
      </p>

      {unclaimedDeposits.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <Label className="text-sm">On-chain deposits</Label>
          {unclaimedDeposits.map((deposit) => (
            <DepositRow
              key={`${deposit.txid}:${deposit.vout}`}
              deposit={deposit}
              onSettled={handleSettled}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DepositRow({ deposit, onSettled }: { deposit: DepositInfo; onSettled: () => void }) {
  const status = getDepositStatus(deposit)
  const [busy, setBusy] = useState(false)
  const [claimQuote, setClaimQuote] = useState<ClaimDepositQuote | null>(null)
  const [refundFees, setRefundFees] = useState<RecommendedFees | null>(null)
  const [refundAddress, setRefundAddress] = useState('')
  const [refundSpeed, setRefundSpeed] = useState<(typeof REFUND_SPEEDS)[number]>(REFUND_SPEEDS[1])
  const canAct = status.type === 'needsClaim' || status.type === 'failed'

  const label = {
    pending: 'Waiting for 3 confirmations',
    claiming: 'Claiming…',
    needsClaim: 'Needs your approval to claim',
    failed: status.type === 'failed' ? status.message : '',
    credited: 'Credited to your balance',
    refunding:
      status.type === 'refunding' && status.lastError
        ? `Refund not broadcast yet: ${status.lastError}`
        : 'Refund broadcasting…',
    refunded: 'Refund sent, waiting to confirm'
  }[status.type]

  const handleReviewClaim = async () => {
    setBusy(true)
    try {
      const quote = await sparkService.fetchClaimDepositQuote(deposit.txid, deposit.vout)
      setClaimQuote(quote.mature)
    } catch (error) {
      toast.error(`Couldn't price the claim: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleClaim = async () => {
    if (!claimQuote) return
    setBusy(true)
    try {
      const outcome = await sparkService.claimDeposit(
        deposit.txid,
        deposit.vout,
        claimQuote.feeSats
      )
      if (outcome.type === 'settled') {
        toast.success('Deposit claimed')
      } else if (outcome.type === 'submitted') {
        toast.success('Claim submitted. The deposit will be credited shortly.')
      } else if (outcome.reason.type === 'maxFeeExceeded') {
        toast.error(
          `The claim fee rose to ${outcome.reason.requiredFeeSats.toLocaleString()} sats. Review it again.`
        )
      } else if (outcome.reason.type === 'providerDeclined') {
        toast.error(`Claim declined: ${outcome.reason.message}`)
      } else {
        toast('The deposit needs more confirmations before it can be claimed')
      }
      setClaimQuote(null)
      onSettled()
    } catch (error) {
      toast.error(`Couldn't claim the deposit: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleReviewRefund = async () => {
    setBusy(true)
    try {
      setRefundFees(await sparkService.recommendedFees())
    } catch (error) {
      toast.error(`Couldn't load network fees: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const refundDestination = normalizeBitcoinAddress(refundAddress)
  const handleRefund = async () => {
    if (!refundDestination || !refundFees) return
    setBusy(true)
    try {
      const txid = await sparkService.refundDeposit(
        deposit.txid,
        deposit.vout,
        refundDestination,
        refundFees[refundSpeed.fee]
      )
      toast.success(`Refund sent (${shortTxid(txid)})`)
      setRefundFees(null)
      onSettled()
    } catch (error) {
      toast.error(`Refund failed: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-card space-y-2 rounded border p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{deposit.amountSats.toLocaleString()} sats</span>
        <a
          href={txUrl(deposit.txid)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground inline-flex items-center gap-1 font-mono hover:underline"
        >
          {shortTxid(deposit.txid)} <ExternalLink className="size-3" />
        </a>
      </div>
      <p className={canAct ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'}>
        {label}
      </p>

      {canAct && !claimQuote && !refundFees && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={handleReviewClaim} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Claim
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={handleReviewRefund}
            disabled={busy}
          >
            Refund
          </Button>
        </div>
      )}

      {claimQuote && (
        <div className="bg-muted space-y-2 rounded-md p-2">
          <DetailRow
            label={`Claim fee${claimQuote.isEstimate ? ' (estimated)' : ''}`}
            value={`${claimQuote.feeSats.toLocaleString()} sats`}
          />
          <DetailRow
            label="You receive"
            value={`${claimQuote.creditAmountSats.toLocaleString()} sats`}
            bold
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => setClaimQuote(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button size="sm" className="flex-1" onClick={handleClaim} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Claim for {claimQuote.feeSats.toLocaleString()} sats
            </Button>
          </div>
        </div>
      )}

      {refundFees && (
        <div className="bg-muted space-y-2 rounded-md p-2">
          <Input
            placeholder="Refund to Bitcoin address"
            value={refundAddress}
            onChange={(e) => setRefundAddress(e.target.value)}
          />
          <div className="grid grid-cols-3 gap-2">
            {REFUND_SPEEDS.map((speed) => (
              <Button
                key={speed.name}
                type="button"
                size="sm"
                variant={refundSpeed === speed ? 'default' : 'outline'}
                onClick={() => setRefundSpeed(speed)}
                className="flex h-auto flex-col gap-0.5 py-2"
              >
                <span className="font-semibold">{speed.name}</span>
                <span>{refundFees[speed.fee]} sat/vB</span>
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => setRefundFees(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={handleRefund}
              disabled={busy || !refundDestination}
            >
              {busy && <Loader2 className="animate-spin" />}
              Refund
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
