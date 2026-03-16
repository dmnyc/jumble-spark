/**
 * payto: URI handling (RFC-8905 / NIP-A3)
 * Parse and normalize payto://<type>/<authority> URIs; known types for UI (icons, labels, dialogs).
 */

export const PAYTO_URI_REGEX = /payto:\/\/([a-z0-9-]+)\/([^\s\]\)\<\"']+)/gi

export interface ParsedPayto {
  type: string
  authority: string
  raw: string
}

/**
 * Parse a payto URI into type and authority. Returns null if invalid.
 */
export function parsePaytoUri(uri: string): ParsedPayto | null {
  const trimmed = uri.trim()
  const m = /^payto:\/\/([a-z0-9-]+)\/(.+)$/i.exec(trimmed)
  if (!m) return null
  const type = m[1].toLowerCase()
  const authority = decodeURIComponent(m[2].replace(/\+/g, ' '))
  if (!type || !authority) return null
  return { type, authority, raw: trimmed }
}

/**
 * Build payto URI from type and authority.
 */
export function buildPaytoUri(type: string, authority: string): string {
  const t = type.toLowerCase().replace(/[^a-z0-9-]/g, '')
  const a = encodeURIComponent(authority.trim())
  return `payto://${t}/${a}`
}

/** Known payment types: NIP-A3 recommended + common extras (crypto, fiat, tipping) */
export const PAYTO_KNOWN_TYPES: Record<
  string,
  { label: string; shortLabel?: string; symbol?: string; category: 'crypto' | 'fiat' | 'lightning' | 'tip' }
> = {
  bitcoin: { label: 'Bitcoin', shortLabel: 'BTC', symbol: '₿', category: 'crypto' },
  lightning: { label: 'Lightning Network', shortLabel: 'LBTC', symbol: '⚡', category: 'lightning' },
  ethereum: { label: 'Ethereum', shortLabel: 'ETH', symbol: 'Ξ', category: 'crypto' },
  monero: { label: 'Monero', shortLabel: 'XMR', symbol: 'ɱ', category: 'crypto' },
  nano: { label: 'Nano', shortLabel: 'XNO', symbol: 'Ӿ', category: 'crypto' },
  cashme: { label: 'Cash App', shortLabel: 'Cash App', symbol: '$', category: 'fiat' },
  revolut: { label: 'Revolut', shortLabel: 'Revolut', symbol: '💳', category: 'fiat' },
  venmo: { label: 'Venmo', shortLabel: 'Venmo', symbol: '$', category: 'fiat' },

  // Common crypto
  dogecoin: { label: 'Dogecoin', shortLabel: 'DOGE', symbol: 'Ð', category: 'crypto' },
  litecoin: { label: 'Litecoin', shortLabel: 'LTC', symbol: 'Ł', category: 'crypto' },
  usdt: { label: 'Tether', shortLabel: 'USDT', symbol: '₮', category: 'crypto' },
  usdc: { label: 'USD Coin', shortLabel: 'USDC', symbol: '◎', category: 'crypto' },
  dai: { label: 'Dai', shortLabel: 'DAI', symbol: '◈', category: 'crypto' },
  euroc: { label: 'Euro Coin', shortLabel: 'EUROC', symbol: '€', category: 'crypto' },
  solana: { label: 'Solana', shortLabel: 'SOL', symbol: '◎', category: 'crypto' },

  // Tipping / donation
  paypal: { label: 'PayPal', shortLabel: 'PayPal', symbol: '💙', category: 'fiat' },
  buymeacoffee: { label: 'Buy Me a Coffee', shortLabel: 'Buy Me a Coffee', symbol: '☕', category: 'tip' },
  'ko-fi': { label: 'Ko-fi', shortLabel: 'Ko-fi', symbol: '☕', category: 'tip' },
  kofi: { label: 'Ko-fi', shortLabel: 'Ko-fi', symbol: '☕', category: 'tip' },
  patreon: { label: 'Patreon', shortLabel: 'Patreon', symbol: '🎭', category: 'tip' },
  github: { label: 'GitHub Sponsors', shortLabel: 'GitHub', symbol: '🐙', category: 'tip' },

  // Fiat / wallets
  'apple-pay': { label: 'Apple Pay', shortLabel: 'Apple Pay', symbol: '🍎', category: 'fiat' },
  'google-pay': { label: 'Google Pay', shortLabel: 'Google Pay', symbol: 'G', category: 'fiat' },

  // Crowdfunding / fundraising
  geyser: { label: 'Geyser Fund', shortLabel: 'Geyser', symbol: '⛲', category: 'tip' },
  gofundme: { label: 'GoFundMe', shortLabel: 'GoFundMe', symbol: '🎯', category: 'tip' },
  kickstarter: { label: 'Kickstarter', shortLabel: 'Kickstarter', symbol: '🚀', category: 'tip' }
}

/** Icon character/symbol for known types; null for unknown (render HelpCircle or ?) */
export function getPaytoIconChar(type: string): string | null {
  const info = getPaytoTypeInfo(type)
  return info?.symbol ?? null
}

/** Logo filename in /payto_logos/ for types that have an asset. Any image format works: .svg, .gif, .jpg, .png, .webp, etc. */
export const PAYTO_LOGO_FILES: Record<string, string> = {
  ethereum: 'ethereum-eth-logo.svg',
  monero: 'Monero.png',
  litecoin: 'Litecoin.png',
  dogecoin: 'dogecoin-doge-logo.svg',
  usdt: 'tether-usdt-logo.svg',
  usdc: 'usd-coin-usdc-logo.svg',
  dai: 'multi-collateral-dai-dai-logo.svg',
  euroc: 'EurC.png',
  solana: 'solana.png',
  bnb: 'BNB.png',
  tron: 'Tron.png',
  xrp: 'XRP.gif',
  'bitcoin-cash': 'bitcoin-cash-bch-logo.svg',
  cashme: 'cashapp.webp',
  venmo: 'venmo.png',
  paypal: 'paypal.webp',
  revolut: 'revolut.webp',
  buymeacoffee: 'buymeacoffee.png',
  'ko-fi': 'ko-fi.png',
  kofi: 'ko-fi.png',
  patreon: 'patreon.png',
  github: 'github_sponsors.png',
  'apple-pay': 'apple_pay.webp',
  'google-pay': 'google_pay.png',
  geyser: 'geyser_fund.webp',
  gofundme: 'gofundme.jpeg',
  kickstarter: 'kickstarter.webp'
}

/** Profile/page URL template for types that have a web profile. Use {authority} as placeholder. Null = no direct link. */
export const PAYTO_PROFILE_URL_TEMPLATES: Record<string, string> = {
  paypal: 'https://paypal.me/{authority}',
  venmo: 'https://venmo.com/{authority}',
  revolut: 'https://revolut.me/{authority}',
  buymeacoffee: 'https://buymeacoffee.com/{authority}',
  'ko-fi': 'https://ko-fi.com/{authority}',
  kofi: 'https://ko-fi.com/{authority}',
  patreon: 'https://patreon.com/{authority}',
  github: 'https://github.com/sponsors/{authority}',
  geyser: 'https://geyser.fund/project/{authority}',
  gofundme: 'https://www.gofundme.com/f/{authority}',
  kickstarter: 'https://www.kickstarter.com/projects/{authority}',
  cashme: 'https://cash.app/{authority}'
}

export function getPaytoProfileUrl(type: string, authority: string): string | null {
  const key = type.toLowerCase()
  const template = PAYTO_PROFILE_URL_TEMPLATES[key]
  if (!template || !authority) return null
  return template.replace('{authority}', encodeURIComponent(authority.trim()))
}

export function getPaytoLogoPath(type: string): string | null {
  const key = type.toLowerCase()
  const file = PAYTO_LOGO_FILES[key]
  if (!file) return null
  return `/payto_logos/${file}`
}

export function getPaytoTypeInfo(type: string): (typeof PAYTO_KNOWN_TYPES)[string] | undefined {
  return PAYTO_KNOWN_TYPES[type.toLowerCase()]
}

export function isKnownPaytoType(type: string): boolean {
  return type.toLowerCase() in PAYTO_KNOWN_TYPES
}

/** Check if type is lightning (opens Zap flow when pubkey available) */
export function isLightningPaytoType(type: string): boolean {
  return type.toLowerCase() === 'lightning'
}
