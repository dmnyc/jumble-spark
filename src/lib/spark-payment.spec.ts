import type { DepositInfo, Payment, SendOnchainFeeQuote } from '@breeztech/breez-sdk-spark/web'
import { describe, expect, it } from 'vitest'
import {
  depositNeedsAction,
  describeSparkPaymentConversions,
  extractSparkPaymentAsset,
  extractSparkPaymentConversionFrom,
  extractSparkPaymentSats,
  formatStableBalance,
  formatTokenAmount,
  getDepositStatus,
  getOnchainFeeSats,
  getStableTokenBalance,
  normalizeBitcoinAddress,
  USDB_TOKEN_IDENTIFIER
} from './spark-payment'

// Tests only set the fields the helpers read.
const payment = (fields: Record<string, unknown>) => fields as unknown as Payment

const btcToUsdb = {
  conversions: [
    {
      from: { asset: { ticker: 'BTC', decimals: 0 }, amount: '23914' },
      to: { asset: { identifier: 'usdb-token', ticker: 'USDB', decimals: 6 }, amount: '15866330' }
    }
  ]
}

describe('formatStableBalance', () => {
  it('formats a zero balance', () => {
    expect(formatStableBalance(0n, 6)).toBe('0.00')
  })

  it('formats whole and fractional parts with two decimals', () => {
    expect(formatStableBalance(12_345_678n, 6)).toBe('12.34')
  })

  it('pads small fractional amounts', () => {
    expect(formatStableBalance(5_000n, 6)).toBe('0.00')
    expect(formatStableBalance(50_000n, 6)).toBe('0.05')
  })

  it('truncates rather than rounds', () => {
    expect(formatStableBalance(1_999_999n, 6)).toBe('1.99')
  })

  it('respects the token decimals', () => {
    expect(formatStableBalance(1_234n, 2)).toBe('12.34')
  })

  it('locale-formats the whole part', () => {
    expect(formatStableBalance(1_234_567_000_000n, 6)).toBe(1_234_567n.toLocaleString() + '.00')
  })
})

describe('formatTokenAmount', () => {
  it('prefixes USDB with a dollar sign', () => {
    expect(formatTokenAmount({ ticker: 'USDB', amount: '15866330', decimals: 6 })).toBe(
      '$15.86 USDB'
    )
  })

  it('leaves other tickers unprefixed', () => {
    expect(formatTokenAmount({ ticker: 'XYZ', amount: '1500', decimals: 2 })).toBe('15.00 XYZ')
  })

  it('handles tokens without decimals', () => {
    expect(formatTokenAmount({ ticker: 'XYZ', amount: '42', decimals: 0 })).toBe('42 XYZ')
  })
})

describe('getStableTokenBalance', () => {
  const usdb = {
    balance: 5_000_000n,
    tokenMetadata: { identifier: USDB_TOKEN_IDENTIFIER, ticker: 'USDB', decimals: 6 }
  }
  const other = { balance: 1n, tokenMetadata: { identifier: 'btkn1other', ticker: 'XYZ' } }

  it('finds USDB in a Map', () => {
    expect(
      getStableTokenBalance(
        new Map([
          ['a', other],
          ['b', usdb]
        ])
      )
    ).toBe(usdb)
  })

  it('finds USDB in an array or plain object', () => {
    expect(getStableTokenBalance([other, usdb])).toBe(usdb)
    expect(getStableTokenBalance({ a: other, b: usdb })).toBe(usdb)
  })

  it('returns undefined when there is no USDB balance', () => {
    expect(getStableTokenBalance(new Map([['a', other]]))).toBeUndefined()
    expect(getStableTokenBalance(undefined)).toBeUndefined()
  })
})

describe('extractSparkPaymentAsset', () => {
  it('uses conversion details for a stable-balance Lightning receive', () => {
    expect(
      extractSparkPaymentAsset(
        payment({
          amount: 15_866_330n,
          method: 'lightning',
          details: { type: 'lightning' },
          conversionDetails: btcToUsdb
        })
      )
    ).toEqual({ ticker: 'USDB', amount: '15866330', decimals: 6 })
  })

  it('does not re-denominate ordinary Lightning payments', () => {
    expect(
      extractSparkPaymentAsset(
        payment({ amount: 21n, method: 'lightning', details: { type: 'lightning' } })
      )
    ).toBeUndefined()
  })

  it('reads token payments from their metadata', () => {
    expect(
      extractSparkPaymentAsset(
        payment({
          amount: 2_500_000n,
          method: 'token',
          details: { type: 'token', metadata: { ticker: 'USDB', name: 'USDB', decimals: 6 } }
        })
      )
    ).toEqual({ ticker: 'USDB', amount: '2500000', decimals: 6 })
  })
})

describe('extractSparkPaymentSats', () => {
  it('uses the Bitcoin leg even when payment.amount is Lightning sats', () => {
    const p = payment({ amount: 23_914n, conversionDetails: btcToUsdb })
    expect(extractSparkPaymentAsset(p)).toEqual({
      ticker: 'USDB',
      amount: '15866330',
      decimals: 6
    })
    expect(extractSparkPaymentSats(p, true)).toBe(23_914)
  })

  it('never treats token base units as sats', () => {
    expect(
      extractSparkPaymentSats(payment({ amount: 15_866_330n, details: { type: 'token' } }), true)
    ).toBe(0)
  })

  it('uses payment.amount for ordinary payments', () => {
    expect(extractSparkPaymentSats(payment({ amount: 21n }), false)).toBe(21)
  })
})

describe('extractSparkPaymentConversionFrom', () => {
  it('names Bitcoin for a conversion into USDB', () => {
    expect(extractSparkPaymentConversionFrom(payment({ conversionDetails: btcToUsdb }))).toBe(
      'Bitcoin'
    )
  })

  it('identifies a conversion from USDB', () => {
    expect(
      extractSparkPaymentConversionFrom(
        payment({
          conversionDetails: {
            conversions: [
              {
                from: { asset: { identifier: 'usdb-token', ticker: 'USDB' }, amount: '15800000' },
                to: { asset: { ticker: 'BTC' }, amount: '20339' }
              }
            ]
          }
        })
      )
    ).toBe('USDB')
  })

  it('returns undefined without conversion details', () => {
    expect(extractSparkPaymentConversionFrom(payment({ amount: 21n }))).toBeUndefined()
  })
})

describe('describeSparkPaymentConversions', () => {
  it('describes a Bitcoin to USDB conversion', () => {
    expect(describeSparkPaymentConversions(payment({ conversionDetails: btcToUsdb }))).toEqual([
      `${(23_914).toLocaleString()} sats → $15.86 USDB`
    ])
  })

  it('formats a non-Bitcoin asset without an identifier by its decimals', () => {
    expect(
      describeSparkPaymentConversions(
        payment({
          conversionDetails: {
            conversions: [
              {
                from: {
                  asset: { identifier: 'usdb-token', ticker: 'USDB', decimals: 6 },
                  amount: '5000000'
                },
                to: { asset: { ticker: 'USDC', decimals: 6 }, amount: '4990000' }
              }
            ]
          }
        })
      )
    ).toEqual(['$5.00 USDB → 4.99 USDC'])
  })

  it('returns nothing without conversion details', () => {
    expect(describeSparkPaymentConversions(payment({ amount: 21n }))).toEqual([])
  })
})

describe('normalizeBitcoinAddress', () => {
  const segwit = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
  const taproot = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'

  it('accepts bech32, bech32m and base58 mainnet addresses', () => {
    expect(normalizeBitcoinAddress(segwit)).toBe(segwit)
    expect(normalizeBitcoinAddress(taproot)).toBe(taproot)
    expect(normalizeBitcoinAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(
      '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
    )
    expect(normalizeBitcoinAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(
      '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'
    )
  })

  it('strips a bitcoin: URI and its parameters', () => {
    expect(normalizeBitcoinAddress(`bitcoin:${segwit}?amount=0.001&label=x`)).toBe(segwit)
  })

  it('lowercases an all-uppercase bech32 address but rejects mixed case', () => {
    expect(normalizeBitcoinAddress(segwit.toUpperCase())).toBe(segwit)
    expect(normalizeBitcoinAddress('bc1QAR0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBeNull()
  })

  it('does not treat Lightning or testnet inputs as mainnet addresses', () => {
    expect(normalizeBitcoinAddress('lnbc10u1p4t29mlpp5m29n7tu200zmd9640yah2patu')).toBeNull()
    expect(normalizeBitcoinAddress('alice@getalby.com')).toBeNull()
    expect(normalizeBitcoinAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBeNull()
  })
})

describe('getOnchainFeeSats', () => {
  const quote = {
    speedFast: { userFeeSat: 300, l1BroadcastFeeSat: 700 },
    speedMedium: { userFeeSat: 200, l1BroadcastFeeSat: 400 },
    speedSlow: { userFeeSat: 100, l1BroadcastFeeSat: 150 }
  } as unknown as SendOnchainFeeQuote

  it('adds the service fee and the L1 broadcast fee for each speed', () => {
    expect(getOnchainFeeSats(quote, 'fast')).toBe(1000)
    expect(getOnchainFeeSats(quote, 'medium')).toBe(600)
    expect(getOnchainFeeSats(quote, 'slow')).toBe(250)
  })
})

describe('getDepositStatus', () => {
  const deposit = (fields: Partial<DepositInfo>) =>
    ({ txid: 'tx', vout: 0, amountSats: 50_000, isMature: false, ...fields }) as DepositInfo

  it('reports unconfirmed and confirmed deposits', () => {
    expect(getDepositStatus(deposit({}))).toEqual({ type: 'pending' })
    expect(getDepositStatus(deposit({ isMature: true }))).toEqual({ type: 'claiming' })
  })

  it('asks for approval when the claim fee is above the automatic limit', () => {
    const d = deposit({
      isMature: true,
      claimError: {
        type: 'maxDepositClaimFeeExceeded',
        tx: 'tx',
        vout: 0,
        requiredFeeSats: 812,
        requiredFeeRateSatPerVbyte: 8
      }
    })
    expect(getDepositStatus(d)).toEqual({ type: 'needsClaim', requiredFeeSats: 812 })
    expect(depositNeedsAction(d)).toBe(true)
  })

  it('treats a missing UTXO or generic error as failed', () => {
    expect(
      getDepositStatus(deposit({ claimError: { type: 'missingUtxo', tx: 'tx', vout: 0 } })).type
    ).toBe('failed')
    expect(getDepositStatus(deposit({ claimError: { type: 'generic', message: 'boom' } }))).toEqual(
      { type: 'failed', message: 'boom' }
    )
  })

  it('prefers refund and instant-claim state over older claim errors', () => {
    const claimError = { type: 'generic', message: 'old' } as const
    expect(getDepositStatus(deposit({ claimError, refundState: { type: 'broadcast' } }))).toEqual({
      type: 'refunded'
    })
    expect(
      getDepositStatus(deposit({ claimError, instantClaimStatus: { type: 'claimed' } }))
    ).toEqual({ type: 'credited' })
    expect(depositNeedsAction(deposit({ claimError, refundState: { type: 'broadcast' } }))).toBe(
      false
    )
  })
})
