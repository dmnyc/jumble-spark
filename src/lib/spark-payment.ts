import type {
  Conversion,
  ConversionAsset,
  ConversionSide,
  DepositInfo,
  OnchainConfirmationSpeed,
  Payment,
  SendOnchainFeeQuote,
  TokenBalance
} from '@breeztech/breez-sdk-spark/web'

/** Spark USDB, the stablecoin backing the wallet's optional USD balance. */
export const USDB_TOKEN_IDENTIFIER =
  'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87'
export const USDB_LABEL = 'USDB'

export type TStableBalance = {
  /** Whether the stable balance is switched on in the user settings */
  active: boolean
  label: string
  /** Raw token amount, in base units */
  balance: bigint
  decimals: number
}

export const EMPTY_STABLE_BALANCE: TStableBalance = {
  active: false,
  label: USDB_LABEL,
  balance: 0n,
  decimals: 6
}

export type TSparkPaymentAsset = {
  ticker: string
  /** Base units, kept as a string to preserve precision beyond Number.MAX_SAFE_INTEGER */
  amount: string
  decimals: number
}

/**
 * Format a token amount for display, truncated (not rounded) to two decimal
 * places with a locale-formatted whole part, e.g. 1234567n at 6 decimals → "1.23".
 */
export function formatStableBalance(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals)
  const whole = amount / divisor
  const fraction = (amount % divisor).toString().padStart(decimals, '0').slice(0, 2)
  return `${whole.toLocaleString()}.${fraction}`
}

export function formatTokenAmount(asset: TSparkPaymentAsset): string {
  const prefix = asset.ticker === USDB_LABEL ? '$' : ''
  if (!asset.decimals) {
    return `${prefix}${BigInt(asset.amount).toLocaleString()} ${asset.ticker}`
  }
  return `${prefix}${formatStableBalance(BigInt(asset.amount), asset.decimals)} ${asset.ticker}`
}

/**
 * Find the USDB entry in GetInfoResponse.tokenBalances. The SDK types it as a
 * Map, but tolerate the array/object shapes a WASM round-trip can produce.
 */
export function getStableTokenBalance(tokenBalances: unknown): TokenBalance | undefined {
  const balances: TokenBalance[] =
    tokenBalances instanceof Map
      ? Array.from(tokenBalances.values())
      : Array.isArray(tokenBalances)
        ? tokenBalances
        : Object.values((tokenBalances as Record<string, TokenBalance>) || {})
  return balances.find((entry) => entry?.tokenMetadata?.identifier === USDB_TOKEN_IDENTIFIER)
}

const isBitcoinAsset = (asset: ConversionAsset | undefined) =>
  asset?.ticker === 'BTC' || asset?.ticker === 'Bitcoin'

function getConversions(payment: Payment): Conversion[] {
  return payment.conversionDetails?.conversions ?? []
}

function getConversionSides(payment: Payment) {
  return getConversions(payment).flatMap((conversion) =>
    [conversion.from, conversion.to].filter(Boolean)
  )
}

/**
 * The token a payment is denominated in, if any. Stable-balance receives keep
 * their original Lightning method, so the token amount has to come from the
 * token side of conversionDetails rather than from payment.amount.
 */
export function extractSparkPaymentAsset(payment: Payment): TSparkPaymentAsset | undefined {
  if (payment.details?.type === 'token') {
    const { metadata } = payment.details
    return {
      ticker: metadata.ticker || metadata.name || 'Token',
      amount: String(payment.amount ?? 0),
      decimals: Number(metadata.decimals ?? 0)
    }
  }

  const tokenSide = getConversionSides(payment).find((side) => side?.asset?.identifier)
  if (!tokenSide) return undefined

  return {
    ticker: tokenSide.asset.ticker || 'Token',
    amount: String(tokenSide.amount ?? 0),
    decimals: Number(tokenSide.asset.decimals ?? 0)
  }
}

/**
 * The sat value of a payment. Token payments may carry token base units in
 * payment.amount, so their sat value comes from the Bitcoin conversion leg —
 * never from the token amount.
 */
export function extractSparkPaymentSats(payment: Payment, hasTokenAsset: boolean): number {
  if (hasTokenAsset) {
    const bitcoinSide = getConversionSides(payment).find((side) => isBitcoinAsset(side?.asset))
    return Number(bitcoinSide?.amount ?? 0)
  }
  return Number(payment.amount ?? 0)
}

/** What a converted payment was converted from, e.g. "Bitcoin" or "USDB". */
export function extractSparkPaymentConversionFrom(payment: Payment): string | undefined {
  const conversion = getConversions(payment).find((item) => item?.from?.asset && item?.to?.asset)
  const ticker = conversion?.from?.asset?.ticker
  if (!ticker) return undefined
  return ticker === 'BTC' ? 'Bitcoin' : ticker
}

function formatConversionSide(side: ConversionSide): string {
  if (isBitcoinAsset(side.asset)) return `${Number(side.amount).toLocaleString()} sats`
  return formatTokenAmount({
    ticker: side.asset.ticker,
    amount: side.amount,
    decimals: side.asset.decimals
  })
}

/** Each conversion leg of a payment, e.g. "23,914 sats → $15.86 USDB". */
export function describeSparkPaymentConversions(payment: Payment): string[] {
  return getConversions(payment)
    .filter((conversion) => conversion?.from?.asset && conversion?.to?.asset)
    .map(
      (conversion) =>
        `${formatConversionSide(conversion.from)} → ${formatConversionSide(conversion.to)}`
    )
}

const BASE58_ADDRESS = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
const BECH32_ADDRESS = /^bc1[02-9ac-hj-np-z]{11,71}$/

/**
 * The mainnet Bitcoin address in an input, or null. Accepts a bare address or a
 * BIP21 `bitcoin:` URI (its parameters are ignored). This only routes the input
 * to the on-chain flow; the SDK does the real validation when preparing.
 */
export function normalizeBitcoinAddress(input: string): string | null {
  const address = input
    .trim()
    .replace(/^bitcoin:/i, '')
    .split('?')[0]
  if (BASE58_ADDRESS.test(address)) return address
  // Bech32 is case-insensitive but never mixed-case
  const lower = address.toLowerCase()
  if ((address === lower || address === address.toUpperCase()) && BECH32_ADDRESS.test(lower)) {
    return lower
  }
  return null
}

/** Total fee for an on-chain send at the given speed: service fee plus L1 broadcast fee. */
export function getOnchainFeeSats(
  quote: SendOnchainFeeQuote,
  speed: OnchainConfirmationSpeed
): number {
  const speedQuote =
    speed === 'fast' ? quote.speedFast : speed === 'medium' ? quote.speedMedium : quote.speedSlow
  return speedQuote.userFeeSat + speedQuote.l1BroadcastFeeSat
}

export type TDepositStatus =
  /** Waiting for the confirmations needed to claim it */
  | { type: 'pending' }
  /** Confirmed; the SDK is claiming it */
  | { type: 'claiming' }
  /** The claim fee is above the automatic-claim limit; the user has to approve it */
  | { type: 'needsClaim'; requiredFeeSats: number }
  /** Claiming failed for another reason */
  | { type: 'failed'; message: string }
  /** Claimed and credited (or being credited) to the balance */
  | { type: 'credited' }
  | { type: 'refunding'; lastError?: string }
  | { type: 'refunded' }

export function getDepositStatus(deposit: DepositInfo): TDepositStatus {
  if (deposit.refundState?.type === 'broadcast') return { type: 'refunded' }
  if (deposit.refundState?.type === 'broadcastPending') {
    return { type: 'refunding', lastError: deposit.refundState.lastError }
  }
  const instant = deposit.instantClaimStatus?.type
  if (instant === 'claimed' || instant === 'submitted') return { type: 'credited' }

  const error = deposit.claimError
  if (error?.type === 'maxDepositClaimFeeExceeded') {
    return { type: 'needsClaim', requiredFeeSats: error.requiredFeeSats }
  }
  if (error?.type === 'missingUtxo') {
    return { type: 'failed', message: "The deposit transaction can't be found on chain" }
  }
  if (error?.type === 'generic') return { type: 'failed', message: error.message }

  return deposit.isMature ? { type: 'claiming' } : { type: 'pending' }
}

/** Deposits that stay stuck until the user claims or refunds them. */
export function depositNeedsAction(deposit: DepositInfo): boolean {
  const { type } = getDepositStatus(deposit)
  return type === 'needsClaim' || type === 'failed'
}
