import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { TPomegranateAuthPurpose } from '../shared/ipc-types.js'

const AUTH_TIMEOUT_MS = 5 * 60 * 1000
const MAX_RESULT_BYTES = 1024 * 1024
const AUTH_PATHS = new Set(['/login/google', '/po/recover/google'])

export type TPomegranateRecoveryAccount = {
  pubkey: string
  threshold: number
  operators: { url: string; pubshard: string }[]
}

export type TPomegranateRecoveryResult = {
  shards: string[]
}

type PendingAuthBase = {
  authUrl: string
  expectedOrigin: string
  purpose: TPomegranateAuthPurpose
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type PendingSingleAuth = PendingAuthBase & {
  mode: 'single'
  resolve: (value: string) => void
}

type PendingRecovery = PendingAuthBase & {
  mode: 'recovery'
  expectedPubkey: string
  account: TPomegranateRecoveryAccount | null
  recoveredOperatorIndexes: Set<number>
  shards: string[]
  resolve: (value: TPomegranateRecoveryResult) => void
}

type PendingAuth = PendingSingleAuth | PendingRecovery

export type TOpenExternal = (url: string) => Promise<void>
export type TLoadRecoveryAccount = (
  centralOrigin: string,
  token: string
) => Promise<TPomegranateRecoveryAccount>

/**
 * Bridges Pomegranate's popup/postMessage flow through the system browser.
 * The system browser keeps the user's existing Google session, while a
 * loopback-only page forwards the one-time result back to Electron.
 */
export class PomegranateAuthServer {
  private server: Server | null = null
  private origin: string | null = null
  private expectedHost: string | null = null
  private startPromise: Promise<string> | null = null
  private readonly pending = new Map<string, PendingAuth>()

  constructor(
    private readonly openExternal: TOpenExternal,
    private readonly loadRecoveryAccount: TLoadRecoveryAccount = fetchRecoveryAccount
  ) {}

  start(): Promise<string> {
    if (this.origin) return Promise.resolve(this.origin)
    if (this.startPromise) return this.startPromise

    const server = createServer((req, res) => this.handle(req, res))
    this.startPromise = new Promise<string>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener('listening', onListening)
        this.startPromise = null
        reject(err)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        const address = server.address()
        if (!address || typeof address === 'string') {
          this.startPromise = null
          server.close()
          reject(new Error('pomegranate-auth: failed to obtain bound address'))
          return
        }

        this.server = server
        this.origin = `http://127.0.0.1:${address.port}`
        this.expectedHost = `127.0.0.1:${address.port}`
        server.on('error', (err) => console.error('[pomegranate-auth]', err))
        resolve(this.origin)
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })
    return this.startPromise
  }

  async authenticate(input: string, purpose: TPomegranateAuthPurpose = 'login'): Promise<string> {
    const authUrl = parsePomegranateAuthUrl(input)
    const resolvedPurpose: TPomegranateAuthPurpose =
      authUrl.pathname.replace(/\/+$/, '') === '/po/recover/google'
        ? 'recovery'
        : normalizeAuthPurpose(purpose)
    const origin = await this.start()
    const requestId = randomBytes(32).toString('hex')
    const startUrl = `${origin}/pomegranate-auth/${requestId}`

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Timed out waiting for Google sign-in'))
      }, AUTH_TIMEOUT_MS)

      this.pending.set(requestId, {
        mode: 'single',
        authUrl: authUrl.toString(),
        expectedOrigin: authUrl.origin,
        purpose: resolvedPurpose,
        resolve,
        reject,
        timer
      })

      this.openExternal(startUrl).catch((err: unknown) => {
        const pending = this.takePending(requestId)
        pending?.reject(err instanceof Error ? err : new Error('Failed to open system browser'))
      })
    })
  }

  async recover(input: string, expectedPubkey: string): Promise<TPomegranateRecoveryResult> {
    const authUrl = parsePomegranateAuthUrl(input)
    if (authUrl.pathname.replace(/\/+$/, '') !== '/login/google') {
      throw new Error('Recovery must start at the central Google login endpoint')
    }
    if (!/^[a-f0-9]{64}$/.test(expectedPubkey)) {
      throw new Error('Invalid expected public key')
    }

    const origin = await this.start()
    const requestId = randomBytes(32).toString('hex')
    const startUrl = `${origin}/pomegranate-auth/${requestId}`

    return new Promise<TPomegranateRecoveryResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Timed out waiting for key recovery'))
      }, AUTH_TIMEOUT_MS)

      this.pending.set(requestId, {
        mode: 'recovery',
        authUrl: authUrl.toString(),
        expectedOrigin: authUrl.origin,
        purpose: 'recovery',
        expectedPubkey,
        account: null,
        recoveredOperatorIndexes: new Set(),
        shards: [],
        resolve,
        reject,
        timer
      })

      this.openExternal(startUrl).catch((err: unknown) => {
        const pending = this.takePending(requestId)
        pending?.reject(err instanceof Error ? err : new Error('Failed to open system browser'))
      })
    })
  }

  stop() {
    for (const requestId of this.pending.keys()) {
      const pending = this.takePending(requestId)
      pending?.reject(new Error('Google sign-in was cancelled'))
    }
    this.server?.close()
    this.server = null
    this.origin = null
    this.expectedHost = null
    this.startPromise = null
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    // DNS-rebinding defense: only accept the literal loopback host and port.
    if (req.headers.host !== this.expectedHost) {
      this.respond(res, 421, 'text/plain; charset=utf-8', 'Misdirected Request')
      return
    }

    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
    const match = requestUrl.pathname.match(/^\/pomegranate-auth\/([a-f0-9]{64})(?:\/complete)?$/)
    if (!match) {
      this.respond(res, 404, 'text/plain; charset=utf-8', 'Not Found')
      return
    }

    const requestId = match[1]
    const pending = this.pending.get(requestId)
    if (!pending) {
      this.respond(res, 410, 'text/plain; charset=utf-8', 'This sign-in request has expired.')
      return
    }

    if (req.method === 'GET' && !requestUrl.pathname.endsWith('/complete')) {
      this.respondAuthPage(res, requestId, pending)
      return
    }
    if (req.method === 'POST' && requestUrl.pathname.endsWith('/complete')) {
      this.receiveResult(req, res, requestId)
      return
    }

    this.respond(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed')
  }

  private receiveResult(req: IncomingMessage, res: ServerResponse, requestId: string) {
    let body = ''
    let tooLarge = false
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      if (tooLarge) return
      body += chunk
      if (Buffer.byteLength(body) > MAX_RESULT_BYTES) {
        tooLarge = true
      }
    })
    req.on('end', () => {
      void this.finishReceivingResult(res, requestId, body, tooLarge)
    })
  }

  private async finishReceivingResult(
    res: ServerResponse,
    requestId: string,
    body: string,
    tooLarge: boolean
  ) {
    if (tooLarge) {
      this.respond(res, 413, 'text/plain; charset=utf-8', 'Result is too large')
      return
    }

    let value: unknown
    let operatorIndex: unknown
    try {
      const result = JSON.parse(body) as { value?: unknown; operatorIndex?: unknown }
      value = result.value
      operatorIndex = result.operatorIndex
    } catch {
      this.respond(res, 400, 'text/plain; charset=utf-8', 'Invalid result')
      return
    }
    if (typeof value !== 'string' || value.length === 0) {
      this.respond(res, 400, 'text/plain; charset=utf-8', 'Invalid result')
      return
    }

    const pending = this.pending.get(requestId)
    if (!pending) {
      this.respond(res, 410, 'text/plain; charset=utf-8', 'This sign-in request has expired.')
      return
    }

    if (pending.mode === 'single') {
      this.takePending(requestId)
      this.respondJson(res, 200, { done: true })
      pending.resolve(value)
      return
    }

    try {
      const step = await this.advanceRecovery(pending, value, operatorIndex)
      if (step.done) {
        this.takePending(requestId)
        this.respondJson(res, 200, { done: true })
        pending.resolve({ shards: [...pending.shards] })
        return
      }
      this.respondJson(res, 200, step)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Key recovery failed'
      this.takePending(requestId)
      this.respondJson(res, 400, { error: message })
      pending.reject(err instanceof Error ? err : new Error(message))
    }
  }

  private async advanceRecovery(
    pending: PendingRecovery,
    value: string,
    operatorIndex: unknown
  ): Promise<
    | { done: true }
    | {
        done: false
        operators: {
          index: number
          label: string
          url: string
          origin: string
          recovered: boolean
        }[]
        recovered: number
        required: number
      }
  > {
    if (!pending.account) {
      if (operatorIndex !== undefined) {
        throw new Error('An operator cannot be selected before central authentication')
      }
      const centralOrigin = new URL(pending.authUrl).origin
      const account = await this.loadRecoveryAccount(centralOrigin, value)
      validateRecoveryAccount(account)
      if (account.pubkey !== pending.expectedPubkey) {
        throw new Error('This Google account is linked to a different Nostr account')
      }
      pending.account = account
    } else {
      if (!Number.isInteger(operatorIndex)) {
        throw new Error('Invalid recovery operator')
      }
      const selectedIndex = operatorIndex as number
      const operator = pending.account.operators[selectedIndex]
      if (!operator || pending.recoveredOperatorIndexes.has(selectedIndex)) {
        throw new Error('Invalid recovery operator')
      }
      if (!value.startsWith(operator.pubshard)) {
        throw new Error('Recovered shard does not match the operator')
      }
      pending.shards.push(value)
      pending.recoveredOperatorIndexes.add(selectedIndex)
    }

    if (pending.shards.length >= pending.account.threshold) {
      return { done: true }
    }

    return this.createRecoveryStep(pending)
  }

  private createRecoveryStep(pending: PendingRecovery) {
    if (!pending.account) {
      throw new Error('Recovery account is not loaded')
    }

    return {
      done: false,
      operators: pending.account.operators.map((operator, index) => {
        const recoveryUrl = parsePomegranateAuthUrl(
          `${new URL(operator.url).origin}/po/recover/google`
        )
        return {
          index,
          label: recoveryUrl.host,
          url: recoveryUrl.toString(),
          origin: recoveryUrl.origin,
          recovered: pending.recoveredOperatorIndexes.has(index)
        }
      }),
      recovered: pending.shards.length,
      required: pending.account.threshold
    }
  }

  private respondAuthPage(res: ServerResponse, requestId: string, pending: PendingAuth) {
    const scriptNonce = randomBytes(18).toString('base64')
    const authUrl = safeScriptJson(pending.authUrl)
    const expectedOrigin = safeScriptJson(pending.expectedOrigin)
    const completePath = safeScriptJson(`/pomegranate-auth/${requestId}/complete`)
    const popupName = safeScriptJson(`PomegranateAuth-${requestId}`)
    const completionText = safeScriptJson('You can close this tab and return to Jumble.')
    const authCopy = getAuthCopy(pending.purpose)
    const initialTitle = authCopy.title
    const initialDescription = authCopy.description
    const completionTitle = safeScriptJson(authCopy.completionTitle)
    const initialRecoveryState = safeScriptJson(
      pending.mode === 'recovery' && pending.account ? this.createRecoveryStep(pending) : null
    )
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Authorizing · Jumble</title>
  <style>
    :root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--surface:#09090b;--background:#171717;--card:#1f1f1f;--foreground:#fafafa;--muted:#a1a1aa;--border:#2e2e33;--primary:#795fbd;--primary-hover:#927bc9;--secondary:#29292d;--destructive:#ef4444}
    *{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:var(--surface);color:var(--foreground);text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
    main{width:min(520px,100%)}.panel{padding:32px;background:var(--background);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.28);text-align:center}h1{margin:0 0 8px;font-size:20px;line-height:1.35;font-weight:600;letter-spacing:-.01em}h1.complete{margin-bottom:12px}.auth-description{max-width:420px;margin:0 auto;color:var(--muted);font-size:14px;line-height:1.55}
    .security-note{display:flex;gap:10px;margin-top:20px;padding:12px;border:1px solid rgba(59,130,246,.65);border-radius:8px;background:rgba(30,58,138,.18);color:#93c5fd;text-align:start}.security-note svg{width:16px;height:16px;flex:0 0 auto;margin-top:2px}.security-note strong{display:block;margin-bottom:2px;font-size:13px;font-weight:600}.security-note span{display:block;font-size:12px;line-height:1.5}
    .spinner{width:28px;height:28px;margin:20px auto 16px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}p{margin:0;color:var(--muted);font-size:14px;line-height:1.5}
    button{border:0;font:inherit;cursor:pointer;transition:background-color .2s,color .2s,opacity .2s}button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}#continue{min-height:40px;margin-top:20px;padding:0 20px;border-radius:8px;background:var(--primary);color:#18181b;font-size:14px;font-weight:600}#continue:hover{background:var(--primary-hover)}
    .operator-list{margin-top:20px;overflow:hidden;border:1px solid var(--border);border-radius:12px;background:var(--card);text-align:start}.operator{min-height:52px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 12px 10px 16px}.operator+.operator{border-top:1px solid rgba(46,46,51,.75)}.operator-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;line-height:1.4}.operator.recovered .operator-label{color:var(--muted)}.operator-action{min-width:96px;height:32px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 12px;border-radius:6px;background:var(--secondary);color:var(--foreground);font-size:12px;font-weight:500}.operator-action:hover:not(:disabled){background:#34343a}.operator-action:disabled{cursor:default;opacity:.5}.operator-action.loading{opacity:1}.operator-action.loading::before{content:"";width:12px;height:12px;flex:0 0 auto;border:2px solid rgba(250,250,250,.3);border-top-color:var(--foreground);border-radius:50%;animation:spin .7s linear infinite}.check{padding:0 9px;color:#22c55e;font-size:18px;line-height:1}
    .error{color:var(--destructive)}[hidden]{display:none!important}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:560px){body{padding:0;background:var(--background)}.panel{padding:28px 20px;border:0;border-radius:0;box-shadow:none}}
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <h1 id="title">${initialTitle}</h1>
      <p id="auth-description" class="auth-description">${initialDescription}</p>
      <div id="security-note" class="security-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <div>
          <strong>How it works</strong>
          <span>Your private key is split into shards held by separate, independent operators, so it is never stored in one place. Google is only used to prove your identity to the operators, never to store your key.</span>
        </div>
      </div>
      <div id="spinner" class="spinner" aria-hidden="true" hidden></div>
      <p id="status" hidden>Waiting for authorization…</p>
      <button id="continue" type="button">Continue with Google</button>
      <div id="operators" class="operator-list" aria-label="Recovery operators" hidden></div>
    </section>
  </main>
  <script nonce="${scriptNonce}">
    (() => {
      let currentAuthUrl = ${authUrl};
      let expectedOrigin = ${expectedOrigin};
      const completePath = ${completePath};
      const popupName = ${popupName};
      const completionText = ${completionText};
      const completionTitle = ${completionTitle};
      const initialRecoveryState = ${initialRecoveryState};
      const button = document.getElementById('continue');
      const title = document.getElementById('title');
      const authDescription = document.getElementById('auth-description');
      const securityNote = document.getElementById('security-note');
      const spinner = document.getElementById('spinner');
      const status = document.getElementById('status');
      const operatorList = document.getElementById('operators');
      let popup = null;
      let activeOperatorIndex = null;

      const setOperatorButtonsDisabled = (disabled) => {
        operatorList.querySelectorAll('.operator-action').forEach((item) => {
          item.disabled = disabled;
        });
      };

      const setActiveOperatorLoading = (operatorIndex, loading) => {
        const activeButton = operatorList.querySelector('[data-operator-index="' + operatorIndex + '"]');
        if (!activeButton) return;
        activeButton.classList.toggle('loading', loading);
        activeButton.textContent = loading ? 'Recovering…' : 'Recover';
        activeButton.setAttribute('aria-busy', String(loading));
      };

      const openAuth = (url, origin, operatorIndex = null) => {
        popup = window.open(url, popupName, 'popup=yes,width=600,height=700');
        if (!popup) {
          spinner.hidden = true;
          status.hidden = false;
          status.className = 'error';
          status.textContent = 'The browser blocked Google sign-in.';
          if (operatorIndex === null) {
            button.hidden = false;
            button.textContent = 'Try again';
            button.style.marginTop = '18px';
          } else {
            setActiveOperatorLoading(operatorIndex, false);
            setOperatorButtonsDisabled(false);
          }
          return;
        }
        currentAuthUrl = url;
        expectedOrigin = origin;
        activeOperatorIndex = operatorIndex;
        setOperatorButtonsDisabled(true);
        if (operatorIndex === null) {
          spinner.hidden = false;
          status.hidden = false;
          button.hidden = true;
          status.className = '';
          status.textContent = 'Waiting for authorization…';
        } else {
          setActiveOperatorLoading(operatorIndex, true);
        }
      };

      const renderOperators = (operators) => {
        operatorList.replaceChildren();
        operators.forEach((operator) => {
          const item = document.createElement('div');
          item.className = 'operator' + (operator.recovered ? ' recovered' : '');

          const label = document.createElement('span');
          label.className = 'operator-label';
          label.textContent = operator.label;
          item.append(label);

          if (operator.recovered) {
            const check = document.createElement('span');
            check.className = 'check';
            check.setAttribute('aria-label', 'Recovered');
            check.textContent = '✓';
            item.append(check);
          } else {
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'operator-action';
            action.dataset.operatorIndex = String(operator.index);
            action.textContent = 'Recover';
            item.append(action);
            action.addEventListener('click', () => {
              openAuth(operator.url, operator.origin, operator.index);
            });
          }
          operatorList.append(item);
        });
        operatorList.hidden = false;
      };

      button.addEventListener('click', () => openAuth(currentAuthUrl, expectedOrigin));

      if (initialRecoveryState) {
        button.hidden = true;
        status.hidden = false;
        status.textContent = 'Recovered ' + initialRecoveryState.recovered + ' of ' + initialRecoveryState.required + ' shards';
        renderOperators(initialRecoveryState.operators);
      }

      window.addEventListener('message', async (event) => {
        if (!popup || event.source !== popup || event.origin !== expectedOrigin) return;
        const data = event.data;
        const value = typeof data === 'string'
          ? data
          : data && typeof data.token === 'string' ? data.token : null;
        if (!value) return;

        try {
          const response = await fetch(completePath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(activeOperatorIndex === null
              ? { value }
              : { value, operatorIndex: activeOperatorIndex })
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'callback failed');
          if (result.done) {
            popup.close();
            spinner.hidden = true;
            button.hidden = true;
            operatorList.hidden = true;
            title.textContent = completionTitle;
            title.classList.add('complete');
            authDescription.hidden = true;
            securityNote.hidden = true;
            status.textContent = completionText;
            return;
          }
          if (!Array.isArray(result.operators)) {
            throw new Error('invalid recovery step');
          }
          popup.close();
          popup = null;
          activeOperatorIndex = null;
          spinner.hidden = true;
          status.textContent = 'Recovered ' + result.recovered + ' of ' + result.required + ' shards';
          renderOperators(result.operators);
        } catch (err) {
          spinner.hidden = true;
          button.hidden = true;
          operatorList.hidden = true;
          status.className = 'error';
          status.textContent = err instanceof Error ? err.message : 'Key recovery failed.';
        }
      });
    })();
  </script>
</body>
</html>`

    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; ` +
        `script-src 'nonce-${scriptNonce}'; style-src 'unsafe-inline'; connect-src 'self'; ` +
        "form-action 'none'"
    )
    this.respond(res, 200, 'text/html; charset=utf-8', html)
  }

  private takePending(requestId: string): PendingAuth | undefined {
    const pending = this.pending.get(requestId)
    if (!pending) return undefined
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    return pending
  }

  private respond(res: ServerResponse, status: number, contentType: string, body: string) {
    res.statusCode = status
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'no-store')
    res.end(body)
  }

  private respondJson(res: ServerResponse, status: number, value: unknown) {
    this.respond(res, status, 'application/json; charset=utf-8', JSON.stringify(value))
  }
}

export function parsePomegranateAuthUrl(input: string): URL {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error('Invalid Pomegranate authentication URL')
  }

  const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password ||
    !AUTH_PATHS.has(pathname)
  ) {
    throw new Error('Invalid Pomegranate authentication URL')
  }
  return parsed
}

function normalizeAuthPurpose(value: unknown): TPomegranateAuthPurpose {
  switch (value) {
    case 'bind':
    case 'disconnect':
    case 'recovery':
      return value
    default:
      return 'login'
  }
}

function getAuthCopy(purpose: TPomegranateAuthPurpose): {
  title: string
  description: string
  completionTitle: string
} {
  switch (purpose) {
    case 'bind':
      return {
        title: 'Connect Google to Jumble',
        description:
          'Jumble needs Google authorization to link this Nostr account for secure sign-in and account recovery on other devices.',
        completionTitle: 'Authorization complete'
      }
    case 'disconnect':
      return {
        title: 'Confirm your Google account',
        description:
          'Jumble needs to verify that you own the linked Google identity before disconnecting this account.',
        completionTitle: 'Verification complete'
      }
    case 'recovery':
      return {
        title: 'Recover your private key',
        description:
          'Jumble needs Google authorization to verify this account and request the key shards required for recovery from your selected operators.',
        completionTitle: 'Recovery complete'
      }
    default:
      return {
        title: 'Sign in to Jumble',
        description:
          'Jumble needs Google authorization to verify your identity and sign you in to the Nostr account linked to it.',
        completionTitle: 'Sign-in complete'
      }
  }
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

async function fetchRecoveryAccount(
  centralOrigin: string,
  token: string
): Promise<TPomegranateRecoveryAccount> {
  const response = await fetch(`${centralOrigin}/account`, {
    headers: { Authorization: `Token ${token}` },
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('No pomegranate account found for this Google login')
    }
    throw new Error('Failed to load the Pomegranate account')
  }
  return (await response.json()) as TPomegranateRecoveryAccount
}

function validateRecoveryAccount(account: TPomegranateRecoveryAccount) {
  if (
    !account ||
    !/^[a-f0-9]{64}$/.test(account.pubkey) ||
    !Number.isInteger(account.threshold) ||
    account.threshold < 1 ||
    !Array.isArray(account.operators) ||
    account.threshold > account.operators.length ||
    account.operators.some(
      (operator) =>
        !operator ||
        typeof operator.url !== 'string' ||
        typeof operator.pubshard !== 'string' ||
        operator.pubshard.length === 0
    )
  ) {
    throw new Error('Invalid Pomegranate account response')
  }
}
