/**
 * NIP-66 relay monitor cron. Runs on the server; nsec stays in env, never sent to client.
 * - On startup: publish kind 10166 (monitor announcement) once.
 * - Every INTERVAL_MS: for each relay in RELAYS_TO_MONITOR, fetch NIP-11, build & publish 30166.
 *
 * Env:
 *   NIP66_MONITOR_NSEC  - required; nsec for signing 30166/10166
 *   RELAYS_TO_MONITOR   - optional; comma-separated wss:// URLs. Default: built-in list.
 *   PUBLISH_RELAYS     - optional; comma-separated relays to publish to. Default: built-in list.
 *   INTERVAL_MS        - optional; ms between full monitor runs (default 3600000 = 1h)
 */

import { finalizeEvent, nip19 } from 'nostr-tools'
import WebSocket from 'ws'

const RELAY_DISCOVERY_KIND = 30166
const RELAY_MONITOR_ANNOUNCEMENT_KIND = 10166

const DEFAULT_RELAYS_TO_MONITOR = [
  'wss://theforest.nostr1.com',
  'wss://orly-relay.imwald.eu',
  'wss://nostr.land',
  'wss://thecitadel.nostr1.com',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
]

const DEFAULT_PUBLISH_RELAYS = [
  'wss://thecitadel.nostr1.com',
  'wss://relay.damus.io',
  'wss://relay.nostr.watch'
]

const INTERVAL_MS = Number(process.env.INTERVAL_MS) || 3600000 // 1 hour

function log (msg, data = {}) {
  const ts = new Date().toISOString()
  console.log(ts, '[nip66-cron]', msg, Object.keys(data).length ? JSON.stringify(data) : '')
}

function normalizeRelayUrl (url) {
  try {
    const u = url.replace(/^ws:\/\//, 'wss://')
    const p = new URL(u.startsWith('wss://') ? u : `wss://${u}`)
    p.pathname = p.pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
    return p.toString()
  } catch {
    return url
  }
}

/** Returns decoded secret key from env. Never log or expose process.env.NIP66_MONITOR_NSEC. */
function getSecretKey () {
  const raw = process.env.NIP66_MONITOR_NSEC
  if (!raw || typeof raw !== 'string') return null
  try {
    const { type, data } = nip19.decode(raw)
    if (type !== 'nsec') return null
    return data
  } catch {
    return null
  }
}

async function fetchNip11 (relayUrl) {
  const httpUrl = relayUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
  try {
    const res = await fetch(httpUrl, { headers: { Accept: 'application/nostr+json' } })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    log('NIP-11 fetch failed', { url: relayUrl, err: err.message })
    return null
  }
}

function build30166 (relayUrl, nip11, sk) {
  const d = normalizeRelayUrl(relayUrl)
  const tags = [['d', d]]
  const nips = nip11?.supported_nips
  if (Array.isArray(nips)) {
    for (const n of nips) tags.push(['N', String(n)])
  }
  const lim = nip11?.limitation
  tags.push(['R', lim?.auth_required ? 'auth' : '!auth'])
  tags.push(['R', lim?.payment_required ? 'payment' : '!payment'])
  const draft = {
    kind: RELAY_DISCOVERY_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags
  }
  return finalizeEvent(draft, sk)
}

function build10166 (sk) {
  const draft = {
    kind: RELAY_MONITOR_ANNOUNCEMENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [['frequency', '3600'], ['c', 'nip11'], ['c', 'ws']]
  }
  return finalizeEvent(draft, sk)
}

function parseListEnv (envVar, defaultList) {
  const raw = process.env[envVar]
  if (!raw || typeof raw !== 'string') return defaultList
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

async function publishEvent (relayUrls, event) {
  const msg = JSON.stringify(['EVENT', event])
  let ok = 0
  const conns = []
  for (const url of relayUrls) {
    try {
      const ws = new WebSocket(url, { handshakeTimeout: 8000 })
      await new Promise((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('error', reject)
        setTimeout(() => reject(new Error('open timeout')), 10000)
      })
      conns.push(ws)
      ws.send(msg)
      await new Promise((resolve) => {
        const onResp = (data) => {
          try {
            const j = JSON.parse(data.toString())
            if (j[0] === 'OK' && j[1] === event.id) {
              ok++
              if (j[2] === true) { /* accepted */ } else { log('Relay rejected event', { url, reason: j[2] }) }
            }
          } finally {
            resolve()
          }
        }
        ws.once('message', onResp)
        setTimeout(resolve, 3000)
      })
    } catch (err) {
      log('Publish relay error', { url, err: err.message })
    }
  }
  for (const ws of conns) {
    try { ws.close() } catch (_) {}
  }
  return ok
}

async function run10166 (sk, publishRelays) {
  const event = build10166(sk)
  log('Publishing 10166 (monitor announcement)')
  const count = await publishEvent(publishRelays, event)
  log('Published 10166', { successCount: count })
}

async function run30166Round (sk, relaysToMonitor, publishRelays) {
  for (const relayUrl of relaysToMonitor) {
    const nip11 = await fetchNip11(relayUrl)
    if (!nip11) continue
    const event = build30166(relayUrl, nip11, sk)
    const count = await publishEvent(publishRelays, event)
    log('Published 30166', { url: relayUrl, successCount: count })
  }
}

async function main () {
  const sk = getSecretKey()
  if (!sk) {
    log('No NIP66_MONITOR_NSEC set; exiting')
    process.exit(0)
  }
  log('NIP-66 monitor cron started (nsec configured)')

  const relaysToMonitor = parseListEnv('RELAYS_TO_MONITOR', DEFAULT_RELAYS_TO_MONITOR)
  const publishRelays = parseListEnv('PUBLISH_RELAYS', DEFAULT_PUBLISH_RELAYS)

  await run10166(sk, publishRelays)

  const run = () => run30166Round(sk, relaysToMonitor, publishRelays)
  await run()
  setInterval(run, INTERVAL_MS)
}

main().catch((err) => {
  console.error('[nip66-cron]', err)
  process.exit(1)
})
