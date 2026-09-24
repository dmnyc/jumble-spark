import initBreezSDK, {
  BreezSdk,
  ClaimDepositOutcome,
  Config,
  connect,
  ConnectRequest,
  defaultConfig,
  DepositInfo,
  EventListener,
  FetchClaimDepositQuoteResponse,
  GetInfoResponse,
  LightningAddressInfo,
  ListPaymentsResponse,
  Network,
  OnchainConfirmationSpeed,
  Payment,
  PrepareSendPaymentResponse,
  ReceivePaymentResponse,
  RecommendedFees,
  SdkEvent,
  Seed,
  SendPaymentResponse
} from '@breeztech/breez-sdk-spark/web'
import { getStableTokenBalance, USDB_LABEL, USDB_TOKEN_IDENTIFIER } from '@/lib/spark-payment'

export type TDrainPreparation = {
  prepareResponse: PrepareSendPaymentResponse
  /** USDB below the conversion minimum, which stays in the wallet */
  leftoverUsdb: bigint
}

/**
 * SparkService - Wrapper for Breez Spark SDK
 *
 * This service provides a simplified interface to the Breez Spark SDK
 * for Lightning wallet functionality in the browser.
 *
 * POC Phase 1: Testing basic initialization, send/receive, and compatibility
 */
class SparkService {
  static instance: SparkService
  private sdk: BreezSdk | null = null
  private config: Config | null = null
  private initialized = false
  private connecting = false
  private currentMnemonic = '' // Store for the session
  private eventListenerId: string | null = null
  private eventCallbacks: ((event: SdkEvent) => void)[] = []

  constructor() {
    if (!SparkService.instance) {
      SparkService.instance = this
    }
    return SparkService.instance
  }

  /**
   * Initialize the Breez SDK WebAssembly module
   * Must be called before any other operations
   */
  async initializeWasm(): Promise<void> {
    if (this.initialized) return

    try {
      console.log('[SparkService] Initializing Breez SDK WebAssembly...')
      await initBreezSDK()
      this.initialized = true
      console.log('[SparkService] WebAssembly initialized successfully')
    } catch (error) {
      console.error('[SparkService] Failed to initialize WebAssembly:', error)
      throw new Error('Failed to initialize Breez Spark SDK')
    }
  }

  /**
   * Connect to Spark SDK with credentials
   *
   * @param apiKey - Breez API key
   * @param mnemonic - 12/24 word seed phrase (for existing wallet recovery)
   * @param network - Network to connect to (mainnet or regtest)
   */
  async connect(
    apiKey: string,
    mnemonic?: string,
    network: Network = 'mainnet'
  ): Promise<{ sdk: BreezSdk; mnemonic: string }> {
    if (!this.initialized) {
      await this.initializeWasm()
    }

    // If already connected, return existing connection
    if (this.sdk) {
      console.log('[SparkService] Already connected, returning existing SDK')
      // Reset connecting flag if it was stuck
      this.connecting = false
      return { sdk: this.sdk, mnemonic: this.currentMnemonic }
    }

    if (this.connecting) {
      console.warn(
        '[SparkService] Connection already in progress, but no SDK instance. Resetting...'
      )
      // Reset the flag if we're stuck (e.g., from a previous failed attempt)
      this.connecting = false
    }

    this.connecting = true

    try {
      console.log('[SparkService] Starting connection process...')
      console.log('[SparkService] Network:', network)
      console.log('[SparkService] API Key present:', !!apiKey)

      console.log('[SparkService] Creating configuration...')
      this.config = defaultConfig(network)
      this.config.apiKey = apiKey
      this.config.privateEnabledDefault = true
      // Offer USDB as the stable balance token. It starts deactivated; the user
      // opts in from the wallet page via the stable balance user setting.
      this.config.stableBalanceConfig = {
        tokens: [{ label: USDB_LABEL, tokenIdentifier: USDB_TOKEN_IDENTIFIER }]
      }
      console.log('[SparkService] Config created:', {
        network: this.config.network,
        syncIntervalSecs: this.config.syncIntervalSecs,
        preferSparkOverLightning: this.config.preferSparkOverLightning,
        privateEnabledDefault: this.config.privateEnabledDefault
      })

      // Prepare seed
      let seed: Seed
      if (mnemonic && mnemonic.trim()) {
        // Clean and validate mnemonic
        const cleanMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
        const wordCount = cleanMnemonic.split(' ').length

        if (wordCount !== 12 && wordCount !== 24) {
          throw new Error(`Invalid mnemonic: expected 12 or 24 words, got ${wordCount}`)
        }

        console.log(`[SparkService] Using ${wordCount}-word mnemonic`)
        seed = { type: 'mnemonic', mnemonic: cleanMnemonic }
        this.currentMnemonic = cleanMnemonic
      } else {
        throw new Error('Mnemonic is required. Please provide a 12 or 24 word BIP39 mnemonic.')
      }

      // Prepare connect request
      const connectRequest: ConnectRequest = {
        config: this.config,
        seed,
        storageDir: 'jumble-spark-wallet'
      }

      console.log('[SparkService] Connect request prepared')
      console.log('[SparkService] Storage dir:', connectRequest.storageDir)
      console.log('[SparkService] Calling SDK connect()...')

      this.sdk = await connect(connectRequest)

      console.log('[SparkService] SDK connected! Instance:', !!this.sdk)

      // Set up event listener
      await this.setupEventListener()

      // Start background sync (non-blocking for fast UI)
      this.syncInBackground()

      console.log('[SparkService] ✅ Connection complete!')
      return { sdk: this.sdk, mnemonic: this.currentMnemonic }
    } catch (error) {
      console.error('[SparkService] ❌ Connection failed with error:')
      console.error('[SparkService] Error type:', error?.constructor?.name)
      console.error(
        '[SparkService] Error message:',
        error instanceof Error ? error.message : String(error)
      )
      console.error('[SparkService] Full error:', error)

      // Re-throw with more context
      if (error instanceof Error) {
        throw new Error(`Spark SDK connection failed: ${error.message}`)
      } else {
        throw new Error(`Spark SDK connection failed: ${String(error)}`)
      }
    } finally {
      this.connecting = false
    }
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    // Reset connecting flag first
    this.connecting = false

    if (this.sdk) {
      try {
        // Remove event listener
        if (this.eventListenerId) {
          await this.sdk.removeEventListener(this.eventListenerId)
          this.eventListenerId = null
        }
        await this.sdk.disconnect()
        console.log('[SparkService] Disconnected')
      } catch (error) {
        console.error('[SparkService] Error during disconnect:', error)
      }
    }
    this.sdk = null
    this.config = null
    this.currentMnemonic = ''
    this.eventCallbacks = []
  }

  /**
   * Reset connection state (useful if stuck in connecting state)
   */
  resetConnectionState(): void {
    console.log('[SparkService] Resetting connection state')
    this.connecting = false
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return this.sdk !== null
  }

  /**
   * Setup event listener for SDK events
   */
  private async setupEventListener(): Promise<void> {
    if (!this.sdk) return

    const listener: EventListener = {
      onEvent: (event: SdkEvent) => {
        console.log('[SparkService] SDK Event:', event.type, event)

        // Notify all registered callbacks
        this.eventCallbacks.forEach((callback) => {
          try {
            callback(event)
          } catch (error) {
            console.error('[SparkService] Error in event callback:', error)
          }
        })
      }
    }

    this.eventListenerId = await this.sdk.addEventListener(listener)
    console.log('[SparkService] Event listener registered:', this.eventListenerId)
  }

  /**
   * Register a callback for SDK events
   * @returns Unsubscribe function
   */
  onEvent(callback: (event: SdkEvent) => void): () => void {
    this.eventCallbacks.push(callback)

    // Return unsubscribe function
    return () => {
      const index = this.eventCallbacks.indexOf(callback)
      if (index > -1) {
        this.eventCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * Sync wallet with the network
   */
  async syncWallet(): Promise<void> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      console.log('[SparkService] Syncing wallet...')
      await this.sdk.syncWallet({})
      console.log('[SparkService] Wallet synced')
    } catch (error) {
      console.error('[SparkService] Sync failed:', error)
      throw error
    }
  }

  /**
   * Start background sync without blocking
   * Used during initialization for fast UI loading
   */
  private syncInBackground(): void {
    if (!this.sdk) return

    console.log('[SparkService] Starting background sync...')

    const syncTimeout = setTimeout(() => {
      console.warn('[SparkService] Sync timeout - sync taking longer than 20s')
    }, 20000)

    this.sdk
      .syncWallet({})
      .then(() => {
        console.log('[SparkService] Background sync completed')
      })
      .catch((error) => {
        console.warn('[SparkService] Background sync failed:', error)
      })
      .finally(() => {
        clearTimeout(syncTimeout)
      })
  }

  /**
   * Get wallet info (balance, etc.)
   */
  async getInfo(ensureSynced = true): Promise<GetInfoResponse> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const info = await this.sdk.getInfo({ ensureSynced })
      console.log('[SparkService] Wallet info:', info)
      return info
    } catch (error) {
      console.error('[SparkService] Failed to get info:', error)
      throw error
    }
  }

  /**
   * Generate Lightning invoice to receive payment
   *
   * @param amountSats - Amount in satoshis (optional for variable amount)
   * @param description - Invoice description
   */
  async receivePayment(
    amountSats?: number,
    description = 'Jumble payment'
  ): Promise<ReceivePaymentResponse> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const response = await this.sdk.receivePayment({
        paymentMethod: {
          type: 'bolt11Invoice',
          description,
          amountSats
        }
      })
      console.log('[SparkService] Invoice generated:', response.paymentRequest)
      return response
    } catch (error) {
      console.error('[SparkService] Failed to generate invoice:', error)
      throw error
    }
  }

  /**
   * Send payment via Lightning
   *
   * @param paymentRequest - Bolt11 invoice or Lightning address
   * @param amountSats - Amount (required for Lightning addresses and zero-amount invoices)
   */
  async sendPayment(paymentRequest: string, amountSats?: number): Promise<SendPaymentResponse> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      // Parse the input to determine what type it is
      console.log('[SparkService] Parsing payment input:', paymentRequest)
      const parsedInput = await this.sdk.parse(paymentRequest)
      console.log('[SparkService] Parsed input:', JSON.stringify(parsedInput, null, 2))
      console.log('[SparkService] Parsed input type:', parsedInput.type)

      // Handle Lightning addresses via LNURL-Pay
      if (parsedInput.type === 'lightningAddress') {
        console.log('[SparkService] Using LNURL-Pay flow for Lightning address')

        if (!amountSats || amountSats <= 0) {
          throw new Error('Amount is required for Lightning addresses')
        }

        // Extract the payRequest from the parsed Lightning address
        const lightningAddressDetails = parsedInput as any
        const payRequest = lightningAddressDetails.payRequest

        console.log('[SparkService] PayRequest:', payRequest)

        // Prepare LNURL-Pay with the payRequest details
        const prepareResponse = await this.sdk.prepareLnurlPay({
          payRequest,
          amount: BigInt(amountSats)
        })

        console.log('[SparkService] LNURL-Pay prepared:', prepareResponse)

        const response = await this.sdk.lnurlPay({
          prepareResponse
        })

        console.log('[SparkService] LNURL-Pay sent:', response)
        return response.payment as any // Return the payment from LNURL response
      } else if (parsedInput.type === 'lnurlPay') {
        console.log('[SparkService] Using LNURL-Pay flow for lnurlPay type')

        if (!amountSats || amountSats <= 0) {
          throw new Error('Amount is required for LNURL-Pay')
        }

        // For lnurlPay type, the parsed input IS the payRequest
        const prepareResponse = await this.sdk.prepareLnurlPay({
          payRequest: parsedInput as any,
          amount: BigInt(amountSats)
        })

        console.log('[SparkService] LNURL-Pay prepared:', prepareResponse)

        const response = await this.sdk.lnurlPay({
          prepareResponse
        })

        console.log('[SparkService] LNURL-Pay sent:', response)
        return response.payment as any
      } else {
        // Regular Bolt11 invoice or other supported types
        console.log('[SparkService] Using regular payment flow')

        const prepareResponse = await this.sdk.prepareSendPayment({
          paymentRequest: { type: 'input', input: paymentRequest },
          amount: amountSats !== undefined ? BigInt(amountSats) : undefined
        })

        console.log('[SparkService] Payment prepared:', prepareResponse)

        const response = await this.sdk.sendPayment({
          prepareResponse,
          options: {
            type: 'bolt11Invoice',
            preferSpark: false
          }
        })

        console.log('[SparkService] Payment sent:', response)
        return response
      }
    } catch (error) {
      console.error('[SparkService] Payment failed:', error)
      throw error
    }
  }

  /**
   * List payment history
   */
  async listPayments(offset = 0, limit = 100): Promise<Payment[]> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const response: ListPaymentsResponse = await this.sdk.listPayments({ offset, limit })
      return response.payments
    } catch (error) {
      console.error('[SparkService] Failed to list payments:', error)
      throw error
    }
  }

  /**
   * The wallet's Bitcoin deposit address. It stays the same unless a new one is
   * requested, and every address handed out keeps being watched for deposits.
   */
  async getBitcoinAddress(newAddress = false): Promise<string> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const response = await this.sdk.receivePayment({
        paymentMethod: { type: 'bitcoinAddress', newAddress }
      })
      return response.paymentRequest
    } catch (error) {
      console.error('[SparkService] Failed to get Bitcoin address:', error)
      throw error
    }
  }

  /** Prepare an on-chain send. The response carries slow/medium/fast fee quotes. */
  async prepareOnchainSend(
    address: string,
    amountSats: number
  ): Promise<PrepareSendPaymentResponse> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      return await this.sdk.prepareSendPayment({
        paymentRequest: { type: 'input', input: address },
        amount: BigInt(amountSats)
      })
    } catch (error) {
      console.error('[SparkService] Failed to prepare on-chain send:', error)
      throw error
    }
  }

  /**
   * Prepare sending the entire balance to a Bitcoin address. USDB is converted
   * to Bitcoin and combined with the sats balance, and fees come out of the
   * total. USDB below the conversion minimum can't be converted and stays.
   */
  async prepareDrainWallet(address: string): Promise<TDrainPreparation> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const info = await this.sdk.getInfo({ ensureSynced: true })
      const usdbBalance = BigInt(getStableTokenBalance(info.tokenBalances)?.balance ?? 0)
      const paymentRequest = { type: 'input', input: address } as const
      const conversionType = {
        type: 'toBitcoin',
        fromTokenIdentifier: USDB_TOKEN_IDENTIFIER
      } as const

      if (usdbBalance > 0n) {
        const { minFromAmount } = await this.sdk.fetchConversionLimits({
          conversionType,
          tokenIdentifier: USDB_TOKEN_IDENTIFIER
        })
        if (!minFromAmount || usdbBalance >= minFromAmount) {
          const prepareResponse = await this.sdk.prepareSendPayment({
            paymentRequest,
            amount: usdbBalance,
            tokenIdentifier: USDB_TOKEN_IDENTIFIER,
            conversionOptions: { conversionType },
            feePolicy: 'feesIncluded'
          })
          return { prepareResponse, leftoverUsdb: 0n }
        }
      }

      if (!info.balanceSats) {
        throw new Error(
          usdbBalance > 0n
            ? 'The USD balance is below the minimum that can be converted to Bitcoin'
            : 'The wallet is empty'
        )
      }
      const prepareResponse = await this.sdk.prepareSendPayment({
        paymentRequest,
        amount: BigInt(info.balanceSats),
        feePolicy: 'feesIncluded'
      })
      return { prepareResponse, leftoverUsdb: usdbBalance }
    } catch (error) {
      console.error('[SparkService] Failed to prepare wallet drain:', error)
      throw error
    }
  }

  /** Send a prepared on-chain payment at the chosen confirmation speed */
  async sendOnchain(
    prepareResponse: PrepareSendPaymentResponse,
    confirmationSpeed: OnchainConfirmationSpeed
  ): Promise<Payment> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const response = await this.sdk.sendPayment({
        prepareResponse,
        options: { type: 'bitcoinAddress', confirmationSpeed }
      })
      console.log('[SparkService] On-chain payment sent:', response.payment.id)
      return response.payment
    } catch (error) {
      console.error('[SparkService] On-chain send failed:', error)
      throw error
    }
  }

  /**
   * On-chain deposits the SDK is tracking: unconfirmed, awaiting a claim,
   * failed to claim, or claimed but not yet settled.
   */
  async listUnclaimedDeposits(): Promise<DepositInfo[]> {
    if (!this.sdk) throw new Error('SDK not connected')

    const response = await this.sdk.listUnclaimedDeposits({})
    return response.deposits
  }

  /** Price claiming a deposit, so the user can approve the fee first */
  async fetchClaimDepositQuote(
    txid: string,
    vout: number
  ): Promise<FetchClaimDepositQuoteResponse> {
    if (!this.sdk) throw new Error('SDK not connected')

    return this.sdk.fetchClaimDepositQuote({ txid, vout })
  }

  /** Claim a deposit, paying at most maxFeeSats */
  async claimDeposit(txid: string, vout: number, maxFeeSats: number): Promise<ClaimDepositOutcome> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const response = await this.sdk.claimDeposit({
        txid,
        vout,
        maxFee: { type: 'fixed', amount: maxFeeSats }
      })
      console.log('[SparkService] Deposit claim outcome:', response.outcome.type)
      return response.outcome
    } catch (error) {
      console.error('[SparkService] Failed to claim deposit:', error)
      throw error
    }
  }

  /** Send a deposit that can't be claimed out to a Bitcoin address instead */
  async refundDeposit(
    txid: string,
    vout: number,
    destinationAddress: string,
    satPerVbyte: number
  ): Promise<string> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const response = await this.sdk.refundDeposit({
        txid,
        vout,
        destinationAddress,
        fee: { type: 'rate', satPerVbyte }
      })
      console.log('[SparkService] Deposit refund broadcast:', response.txId)
      return response.txId
    } catch (error) {
      console.error('[SparkService] Failed to refund deposit:', error)
      throw error
    }
  }

  /** Current Bitcoin network fee rates, in sat/vB */
  async recommendedFees(): Promise<RecommendedFees> {
    if (!this.sdk) throw new Error('SDK not connected')

    return this.sdk.recommendedFees()
  }

  /**
   * Whether the USDB stable balance is active. While it is, the SDK converts
   * excess sats to USDB and converts back when a Bitcoin payment needs it.
   */
  async isStableBalanceActive(): Promise<boolean> {
    if (!this.sdk) throw new Error('SDK not connected')

    const settings = await this.sdk.getUserSettings()
    return settings.stableBalanceActiveLabel === USDB_LABEL
  }

  /**
   * Turn the USDB stable balance on or off. Enabling converts the excess sats
   * balance to USDB; disabling converts the remaining USDB back to Bitcoin.
   */
  async setStableBalanceEnabled(enabled: boolean): Promise<void> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      await this.sdk.updateUserSettings({
        stableBalanceActiveLabel: enabled ? { type: 'set', label: USDB_LABEL } : { type: 'unset' }
      })
      console.log('[SparkService] Stable balance', enabled ? 'enabled' : 'disabled')
      await this.sdk.syncWallet({})
    } catch (error) {
      console.error('[SparkService] Failed to update stable balance:', error)
      throw error
    }
  }

  /**
   * Register a Lightning address
   * Format: username@domain
   */
  async registerLightningAddress(
    username: string,
    description?: string
  ): Promise<LightningAddressInfo> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const response = await this.sdk.registerLightningAddress({
        username,
        description: description || 'Pay breez.tips user'
      })
      console.log('[SparkService] Lightning address registered:', response.lightningAddress)
      return response
    } catch (error) {
      console.error('[SparkService] Failed to register Lightning address:', error)
      throw error
    }
  }

  /**
   * Get current Lightning address if registered
   */
  async getLightningAddress(): Promise<LightningAddressInfo | null> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const response = await this.sdk.getLightningAddress()
      return response || null
    } catch (error) {
      console.error('[SparkService] Failed to get Lightning address:', error)
      return null
    }
  }

  /**
   * Check if a Lightning address username is available
   */
  async checkLightningAddressAvailable(username: string): Promise<boolean> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      const isAvailable = await this.sdk.checkLightningAddressAvailable({ username })
      return isAvailable
    } catch (error) {
      console.error('[SparkService] Failed to check Lightning address availability:', error)
      throw error
    }
  }

  /**
   * Delete current Lightning address
   */
  async deleteLightningAddress(): Promise<void> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      await this.sdk.deleteLightningAddress()
      console.log('[SparkService] Lightning address deleted')
    } catch (error) {
      console.error('[SparkService] Failed to delete Lightning address:', error)
      throw error
    }
  }

  /**
   * Find an available username variation based on preferred name
   * Sanitizes the name and tries variations with numeric suffixes if needed
   */
  async suggestAvailableUsername(preferredName: string): Promise<string> {
    if (!this.sdk) throw new Error('SDK not connected')

    // Sanitize username: lowercase, alphanumeric + underscores only
    const sanitize = (name: string): string => {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '') // Remove special chars
        .replace(/^[0-9]+/, '') // Remove leading numbers
        .substring(0, 32) // Max length
        .trim()
    }

    let username = sanitize(preferredName)

    // Fallback if sanitization results in empty string
    if (!username) {
      username = 'user'
    }

    try {
      // Check if base username is available
      const isAvailable = await this.checkLightningAddressAvailable(username)
      if (isAvailable) {
        return username
      }

      // Try variations with numeric suffix
      for (let i = 1; i <= 999; i++) {
        const variation = `${username}${i}`
        const isVariationAvailable = await this.checkLightningAddressAvailable(variation)
        if (isVariationAvailable) {
          return variation
        }
      }

      // If we couldn't find anything after 999 tries, throw error
      throw new Error('Unable to find available username variation')
    } catch (error) {
      console.error('[SparkService] Failed to suggest available username:', error)
      throw error
    }
  }

  /**
   * Register or update Lightning address
   * If address already exists, deletes it first then registers the new one
   */
  async setLightningAddress(username: string, description?: string): Promise<LightningAddressInfo> {
    if (!this.sdk) throw new Error('SDK not connected')

    try {
      // Check if we already have a Lightning address
      const existing = await this.getLightningAddress()

      if (existing) {
        console.log(
          '[SparkService] Deleting existing Lightning address:',
          existing.lightningAddress
        )
        await this.deleteLightningAddress()
      }

      // Register new address
      const response = await this.registerLightningAddress(username, description)
      console.log('[SparkService] Lightning address set:', response.lightningAddress)
      return response
    } catch (error) {
      console.error('[SparkService] Failed to set Lightning address:', error)
      throw error
    }
  }
}

const instance = new SparkService()
export default instance
