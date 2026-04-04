/**
 * payto: URI handling (RFC-8905 / NIP-A3)
 * Parse and normalize payto://<type>/<authority> URIs; known types for UI (icons, labels, dialogs).
 */

import { publicAssetUrl } from '@/constants'

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
  const typeRaw = m[1].toLowerCase()
  const authority = decodeURIComponent(m[2].replace(/\+/g, ' '))
  if (!typeRaw || !authority) return null
  const type = getCanonicalPaytoType(typeRaw)
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
  { label: string; symbol?: string; category: 'bitcoin' | 'crypto' | 'stablecoin' | 'fiat' | 'lightning' | 'tip' }
> = {
  bitcoin: { label: 'Bitcoin', symbol: '₿', category: 'bitcoin' },
  sats: { label: 'Satoshis', symbol: '丰', category: 'bitcoin' },
  lightning: { label: 'Lightning Network', symbol: '⚡', category: 'lightning' },
  ethereum: { label: 'Ethereum', symbol: 'Ξ', category: 'crypto' },
  monero: { label: 'Monero', symbol: 'ɱ', category: 'crypto' },
  nano: { label: 'Nano', symbol: 'Ӿ', category: 'crypto' },
  cashme: { label: 'Cash App', symbol: '$', category: 'fiat' },
  revolut: { label: 'Revolut', symbol: '💳', category: 'fiat' },
  venmo: { label: 'Venmo', symbol: '$', category: 'fiat' },

  // Common crypto
  'bitcoin-cash': { label: 'Bitcoin Cash', symbol: '₿', category: 'crypto' },
  dogecoin: { label: 'Dogecoin', symbol: 'Ð', category: 'crypto' },
  litecoin: { label: 'Litecoin', symbol: 'Ł', category: 'crypto' },
  usdt: { label: 'Tether', symbol: '₮', category: 'stablecoin' },
  usdc: { label: 'USD Coin', symbol: '◎', category: 'stablecoin' },
  dai: { label: 'Dai', symbol: '◈', category: 'crypto' },
  euroc: { label: 'Euro Coin', symbol: '€', category: 'stablecoin' },
  solana: { label: 'Solana', symbol: '◎', category: 'crypto' },

  // Tipping / donation
  paypal: { label: 'PayPal', symbol: '💙', category: 'fiat' },
  buymeacoffee: { label: 'Buy Me a Coffee', symbol: '☕', category: 'tip' },
  'ko-fi': { label: 'Ko-fi', symbol: '☕', category: 'tip' },
  kofi: { label: 'Ko-fi', symbol: '☕', category: 'tip' },
  patreon: { label: 'Patreon', symbol: '🎭', category: 'tip' },
  github: { label: 'GitHub Sponsors', symbol: '🐙', category: 'tip' },

  // Fiat / wallets
  'apple-pay': { label: 'Apple Pay', symbol: '🍎', category: 'fiat' },
  'google-pay': { label: 'Google Pay', symbol: 'G', category: 'fiat' },

  // Crowdfunding / fundraising
  geyser: { label: 'Geyser Fund', symbol: '⛲', category: 'tip' },
  gofundme: { label: 'GoFundMe', symbol: '🎯', category: 'tip' },
  kickstarter: { label: 'Kickstarter', symbol: '🚀', category: 'tip' }
}

/**
 * Short labels accepted after payto:// that map to a canonical type.
 * e.g. payto://BTC/..., payto://LBTC/..., payto://DOGE/... are recognized as bitcoin, lightning, dogecoin.
 */
export const PAYTO_TYPE_ALIASES: Record<string, string> = {
  btc: 'bitcoin',
  lbtc: 'lightning',
  doge: 'dogecoin',
  eth: 'ethereum',
  xmr: 'monero',
  ltc: 'litecoin',
  xno: 'nano',
  sol: 'solana',
  bch: 'bitcoin-cash'
}

export function getCanonicalPaytoType(type: string): string {
  const key = type.toLowerCase().trim()
  return PAYTO_TYPE_ALIASES[key] ?? key
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
  'apple-pay': 'apple_pay.svg',
  'google-pay': 'google_pay.jpeg',
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
  return publicAssetUrl(`payto_logos/${file}`)
}

export function getPaytoTypeInfo(type: string): (typeof PAYTO_KNOWN_TYPES)[string] | undefined {
  return PAYTO_KNOWN_TYPES[getCanonicalPaytoType(type)]
}

export function isKnownPaytoType(type: string): boolean {
  return getCanonicalPaytoType(type) in PAYTO_KNOWN_TYPES
}

/** Check if type is lightning (opens Zap flow when pubkey available) */
export function isLightningPaytoType(type: string): boolean {
  return getCanonicalPaytoType(type) === 'lightning'
}
