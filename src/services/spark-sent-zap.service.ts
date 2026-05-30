/**
 * SparkSentZapService - Remembers the Nostr recipient of outgoing Spark zaps
 *
 * The Spark SDK does not carry the recipient's Nostr identity on a payment we
 * send, so we record it locally at send time keyed by the bolt11 invoice we
 * paid. When listing payments later, a sent Lightning payment exposes that same
 * invoice (`payment.details.invoice`), letting us recover the recipient and
 * show their avatar + name.
 */
const STORAGE_KEY = 'spark.sentZapRecipients'
const MAX_ENTRIES = 1000

type StoredZap = { p: string; c?: string }

class SparkSentZapService {
  static instance: SparkSentZapService
  private map: Record<string, StoredZap> = {}
  private order: string[] = []

  constructor() {
    if (!SparkSentZapService.instance) {
      this.load()
      SparkSentZapService.instance = this
    }
    return SparkSentZapService.instance
  }

  private load(): void {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        this.map = JSON.parse(raw) || {}
        this.order = Object.keys(this.map)
      }
    } catch {
      this.map = {}
      this.order = []
    }
  }

  private persist(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.map))
    } catch {
      // Ignore quota / serialization errors - this is a best-effort cache
    }
  }

  /**
   * Record the recipient of a zap we just paid.
   * @param invoice - The bolt11 invoice that was paid
   * @param recipientPubkey - The recipient's Nostr pubkey
   * @param comment - Optional zap comment
   */
  record(invoice: string, recipientPubkey: string, comment?: string): void {
    if (!invoice || !recipientPubkey) return

    if (!this.map[invoice]) {
      this.order.push(invoice)
    }
    this.map[invoice] = { p: recipientPubkey, ...(comment ? { c: comment } : {}) }

    // Evict oldest entries beyond the cap
    while (this.order.length > MAX_ENTRIES) {
      const oldest = this.order.shift()
      if (oldest) delete this.map[oldest]
    }

    this.persist()
  }

  /**
   * Look up the recipient identity for a sent payment by its bolt11 invoice.
   * Mirrors the shape returned by SparkZapReceiptService.getZapInfo.
   */
  getZapInfo(invoice?: string): { pubkey: string; comment?: string } | null {
    if (!invoice) return null
    const stored = this.map[invoice]
    if (!stored) return null
    return { pubkey: stored.p, comment: stored.c }
  }
}

const instance = new SparkSentZapService()
export default instance
