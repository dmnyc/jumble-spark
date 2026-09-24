import {
  EMPTY_STABLE_BALANCE,
  getStableTokenBalance,
  TStableBalance,
  USDB_LABEL
} from '@/lib/spark-payment'
import { useNostr } from '@/providers/NostrProvider'
import sparkService from '@/services/spark.service'
import sparkStorage from '@/services/spark-storage.service'
// import sparkProfileSync from '@/services/spark-profile-sync.service' // Disabled until Breez adds NIP-57 support
import sparkZapReceipt from '@/services/spark-zap-receipt.service'
import type { DepositInfo, GetInfoResponse } from '@breeztech/breez-sdk-spark/web'
import { createContext, useContext, useEffect, useState } from 'react'

type TSparkWalletContext = {
  connected: boolean
  connecting: boolean
  balance: number | null
  /** True until the balance is final: from connecting until the first sync (or a failed connect) */
  balanceLoading: boolean
  lightningAddress: string | null
  lightningAddressLoading: boolean
  stableBalance: TStableBalance
  setStableBalanceEnabled: (enabled: boolean) => Promise<void>
  /** On-chain deposits not yet settled into the balance */
  unclaimedDeposits: DepositInfo[]
  refreshDeposits: () => Promise<void>
  refreshWalletState: () => Promise<void>
  deleteWallet: () => Promise<void>
}

const SparkWalletContext = createContext<TSparkWalletContext | undefined>(undefined)

export const useSparkWallet = () => {
  const context = useContext(SparkWalletContext)
  if (!context) {
    throw new Error('useSparkWallet must be used within a SparkWalletProvider')
  }
  return context
}

export function SparkWalletProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, publish } = useNostr()
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [lightningAddress, setLightningAddress] = useState<string | null>(null)
  const [lightningAddressLoading, setLightningAddressLoading] = useState(false)
  const [stableBalance, setStableBalance] = useState<TStableBalance>(EMPTY_STABLE_BALANCE)
  const [unclaimedDeposits, setUnclaimedDeposits] = useState<DepositInfo[]>([])

  const refreshDeposits = async () => {
    try {
      setUnclaimedDeposits(await sparkService.listUnclaimedDeposits())
    } catch (error) {
      console.error('[SparkWalletProvider] Failed to list on-chain deposits:', error)
    }
  }

  // Apply a getInfo() result: the sats balance plus the USDB stable balance
  const applyWalletInfo = async (info: GetInfoResponse) => {
    setBalance(info.balanceSats)
    const token = getStableTokenBalance(info.tokenBalances)
    const active = await sparkService.isStableBalanceActive().catch((error) => {
      console.error('[SparkWalletProvider] Failed to read stable balance setting:', error)
      return null
    })
    setStableBalance((prev) => ({
      // Keep the last known setting if it couldn't be read this time
      active: active ?? prev.active,
      label: token?.tokenMetadata.ticker || USDB_LABEL,
      balance: BigInt(token?.balance ?? 0),
      decimals: token?.tokenMetadata.decimals ?? EMPTY_STABLE_BALANCE.decimals
    }))
  }

  // The cached balance can be stale until the wallet's first sync, so wait for
  // that before treating the balance as final
  const loadSyncedBalance = () =>
    sparkService
      .getInfo(true)
      .then(applyWalletInfo)
      .catch((err) => console.error('[SparkWalletProvider] Failed to get synced info:', err))
      .finally(() => {
        setBalanceLoading(false)
        refreshDeposits()
      })

  // Auto-connect Spark wallet when user is logged in
  useEffect(() => {
    if (!pubkey) {
      // User logged out, disconnect Spark wallet
      if (sparkService.isConnected()) {
        console.log('[SparkWalletProvider] User logged out, disconnecting Spark wallet')
        sparkService.disconnect()
        setConnected(false)
        setBalance(null)
        setBalanceLoading(true)
        setStableBalance(EMPTY_STABLE_BALANCE)
        setUnclaimedDeposits([])
        setLightningAddress(null)
      }
      return
    }

    // Check if user has a saved wallet
    const hasSavedWallet = sparkStorage.hasMnemonic(pubkey)
    if (!hasSavedWallet) {
      console.log('[SparkWalletProvider] No saved wallet found for user')
      return
    }

    // If already connected, update state and don't reconnect
    if (sparkService.isConnected()) {
      console.log('[SparkWalletProvider] Spark wallet already connected, updating state...')
      if (!connected) {
        setConnected(true)
        // Fetch wallet info
        sparkService
          .getInfo(false)
          .then(async (info) => {
            await applyWalletInfo(info)
            console.log('[SparkWalletProvider] State synced with existing connection')
          })
          .catch((err) => console.error('[SparkWalletProvider] Failed to get info:', err))
          .then(loadSyncedBalance)

        // Fetch Lightning address
        sparkService
          .getLightningAddress()
          .then((addr) => {
            setLightningAddress(addr?.lightningAddress || null)
          })
          .catch((err) => console.error('[SparkWalletProvider] Failed to get address:', err))
      }
      return
    }

    // Auto-connect the wallet with timeout
    const autoConnect = async () => {
      if (connecting) {
        console.log('[SparkWalletProvider] Already connecting, skipping...')
        return
      }

      // Set a timeout to prevent hanging forever
      const timeoutId = setTimeout(() => {
        console.error('[SparkWalletProvider] Auto-connect timeout after 30 seconds')
        setConnecting(false)
        setBalanceLoading(false)
      }, 30000) // 30 second timeout

      let didConnect = false
      try {
        setConnecting(true)
        setBalanceLoading(true)
        console.log('[SparkWalletProvider] Auto-connecting Spark wallet...')

        // Load and decrypt mnemonic
        console.log('[SparkWalletProvider] Loading encrypted mnemonic...')
        const mnemonic = await sparkStorage.loadMnemonic(pubkey)
        if (!mnemonic) {
          console.error('[SparkWalletProvider] No mnemonic found or failed to decrypt')
          clearTimeout(timeoutId)
          return
        }
        console.log('[SparkWalletProvider] Mnemonic loaded and decrypted successfully')

        // Get API key
        const apiKey = import.meta.env.VITE_BREEZ_SPARK_API_KEY
        if (!apiKey) {
          console.error('[SparkWalletProvider] No API key found')
          clearTimeout(timeoutId)
          return
        }

        // Connect to Spark (returns quickly, sync runs in background)
        console.log('[SparkWalletProvider] Connecting to Spark SDK...')
        await sparkService.connect(apiKey, mnemonic, 'mainnet')
        console.log('[SparkWalletProvider] ✅ Spark SDK connected')

        setConnected(true)
        didConnect = true

        // Get cached wallet info immediately (no sync wait)
        console.log('[SparkWalletProvider] Getting cached wallet info...')
        sparkService
          .getInfo(false)
          .then(async (info) => {
            await applyWalletInfo(info)
            console.log('[SparkWalletProvider] Cached balance loaded:', info.balanceSats, 'sats')
          })
          .catch((err) => console.error('[SparkWalletProvider] Failed to get cached info:', err))
          .then(loadSyncedBalance)

        // Get Lightning address in background
        setLightningAddressLoading(true)
        sparkService
          .getLightningAddress()
          .then((address) => {
            setLightningAddress(address?.lightningAddress || null)
            console.log(
              '[SparkWalletProvider] Lightning address:',
              address?.lightningAddress || 'not registered'
            )
          })
          .catch((err) => console.error('[SparkWalletProvider] Failed to get address:', err))
          .finally(() => setLightningAddressLoading(false))

        console.log('[SparkWalletProvider] ✅ Wallet connected (sync running in background)')

        // NOTE: Auto-sync disabled until Breez adds NIP-57 support
        // The Breez Lightning address works for regular payments but does not support
        // Nostr zaps because the LNURL endpoint is missing required NIP-57 fields:
        // - allowsNostr: true
        // - nostrPubkey: <hex-pubkey>
        //
        // Regular Lightning payments to daniel@breez.tips work fine, but NIP-57 compliant
        // wallets reject zap attempts with "invalid lightning address" error.
        //
        // Feature request submitted to Breez SDK team.
        // TODO: Re-enable auto-sync once Breez adds NIP-57 support
        //
        // Auto-sync Lightning address to Nostr profile if needed
        // if (address?.lightningAddress && profileEvent && publish && updateProfileEvent) {
        //   try {
        //     const profileContent = JSON.parse(profileEvent.content)
        //     if (profileContent.lud16 !== address.lightningAddress) {
        //       console.log('[SparkWalletProvider] Auto-syncing Lightning address to Nostr profile...')
        //       await sparkProfileSync.syncLightningAddressToProfile(
        //         address.lightningAddress,
        //         profileEvent,
        //         publish,
        //         updateProfileEvent
        //       )
        //       console.log('[SparkWalletProvider] ✅ Lightning address synced to profile')
        //     } else {
        //       console.log('[SparkWalletProvider] Lightning address already in profile')
        //     }
        //   } catch (error) {
        //     console.error('[SparkWalletProvider] Failed to auto-sync Lightning address:', error)
        //     // Non-critical error, don't throw
        //   }
        // }

        clearTimeout(timeoutId)
      } catch (error) {
        console.error('[SparkWalletProvider] ❌ Auto-connect failed:', error)
        console.error(
          '[SparkWalletProvider] Error details:',
          error instanceof Error ? error.message : String(error)
        )
        setConnected(false)
        clearTimeout(timeoutId)
      } finally {
        setConnecting(false)
        // Nothing more is coming if the connect didn't go through (including early returns)
        if (!didConnect) setBalanceLoading(false)
      }
    }

    autoConnect()
  }, [pubkey])

  // Listen for balance updates and publish zap receipts for incoming payments
  useEffect(() => {
    if (!connected) return

    const unsubscribe = sparkService.onEvent(async (event) => {
      if (
        event.type === 'newDeposits' ||
        event.type === 'unclaimedDeposits' ||
        event.type === 'claimedDeposits' ||
        event.type === 'paymentSucceeded' ||
        event.type === 'synced'
      ) {
        refreshDeposits()
      }

      if (event.type === 'paymentSucceeded' || event.type === 'synced') {
        try {
          const info = await sparkService.getInfo(false)
          await applyWalletInfo(info)
          if (event.type === 'synced') setBalanceLoading(false)
          console.log('[SparkWalletProvider] Balance updated:', info.balanceSats, 'sats')

          // If this is an incoming payment (received), publish zap receipt
          if (event.type === 'paymentSucceeded' && event.payment) {
            const payment = event.payment
            const isReceived = payment.paymentType === 'receive'

            if (isReceived && publish) {
              console.log('[SparkWalletProvider] Incoming payment received, checking for zap...')
              console.log('[SparkWalletProvider] Payment object:', JSON.stringify(payment, null, 2))

              // Check if this is a zap payment (has zap request in description)
              if (sparkZapReceipt.isZapPayment(payment)) {
                console.log('[SparkWalletProvider] This is a zap! Publishing zap receipt...')
                await sparkZapReceipt.publishZapReceipt(payment, publish)
              } else {
                console.log('[SparkWalletProvider] Regular payment, not a zap')
                const description =
                  payment.details?.type === 'lightning' ? payment.details.description : undefined
                console.log('[SparkWalletProvider] Payment description:', description)
              }
            }
          }
        } catch (error) {
          console.error('[SparkWalletProvider] Failed to update balance:', error)
        }
      }
    })

    return () => unsubscribe()
  }, [connected, publish])

  // Refresh wallet state (balance and Lightning address)
  const refreshWalletState = async () => {
    if (!sparkService.isConnected()) {
      console.log('[SparkWalletProvider] Cannot refresh - wallet not connected')
      return
    }

    try {
      // Update connected state if not already set
      if (!connected) {
        console.log('[SparkWalletProvider] Updating connected state to true')
        setConnected(true)
      }

      const info = await sparkService.getInfo(false)
      await applyWalletInfo(info)
      console.log('[SparkWalletProvider] Balance updated:', info.balanceSats, 'sats')
      // e.g. a wallet just connected from the wallet page: settle once it has synced
      if (balanceLoading) loadSyncedBalance()

      const address = await sparkService.getLightningAddress()
      setLightningAddress(address?.lightningAddress || null)
      console.log(
        '[SparkWalletProvider] Lightning address:',
        address?.lightningAddress || 'not registered'
      )

      console.log('[SparkWalletProvider] Wallet state refreshed')
    } catch (error) {
      console.error('[SparkWalletProvider] Failed to refresh wallet state:', error)
    }
  }

  // Turn the USDB stable balance on or off, then pick up the converted balances
  const setStableBalanceEnabled = async (enabled: boolean) => {
    await sparkService.setStableBalanceEnabled(enabled)
    await applyWalletInfo(await sparkService.getInfo(false))
  }

  // Delete wallet from storage and disconnect
  const deleteWallet = async () => {
    if (!pubkey) {
      console.error('[SparkWalletProvider] Cannot delete wallet - no pubkey')
      return
    }

    try {
      console.log('[SparkWalletProvider] Deleting wallet...')

      // Disconnect from Spark SDK
      await sparkService.disconnect()

      // Delete encrypted mnemonic from storage
      sparkStorage.deleteMnemonic(pubkey)

      // Reset state
      setConnected(false)
      setBalance(null)
      setBalanceLoading(true)
      setStableBalance(EMPTY_STABLE_BALANCE)
      setUnclaimedDeposits([])
      setLightningAddress(null)

      console.log('[SparkWalletProvider] ✅ Wallet deleted successfully')
    } catch (error) {
      console.error('[SparkWalletProvider] ❌ Failed to delete wallet:', error)
      throw error
    }
  }

  return (
    <SparkWalletContext.Provider
      value={{
        connected,
        connecting,
        balance,
        balanceLoading,
        lightningAddress,
        lightningAddressLoading,
        stableBalance,
        setStableBalanceEnabled,
        unclaimedDeposits,
        refreshDeposits,
        refreshWalletState,
        deleteWallet
      }}
    >
      {children}
    </SparkWalletContext.Provider>
  )
}
