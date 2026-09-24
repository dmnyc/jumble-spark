import i18n from '@/i18n'

// Signers that require manual approval — NIP-46 remote signers (bunker /
// nostr-connect) and NIP-07 browser extensions configured to prompt — forward
// a sign request to the user's signer and wait. Without any feedback the user
// has no idea a signature is pending and may forget to approve it.
//
// We show a deliberately low-key hint: after a short delay (so instant
// auto-approvals stay silent), an app-integrated status appears and disappears
// once the signature comes back. Concurrent sign requests are reference-counted
// into a single status so frequent signing never stacks up. The user can dismiss
// the status for the current batch without cancelling the signing request.
//
// We also bound the wait with a timeout: if the signer never responds (offline
// bunker, closed extension popup, etc.) the request rejects instead of hanging
// forever. The window is generous so a user manually approving still makes it.

const SHOW_DELAY_MS = 1000
const TIMEOUT_MS = 30_000

let pending = 0
let timer: ReturnType<typeof setTimeout> | null = null
let visible = false
let dismissed = false
const listeners = new Set<() => void>()

function setVisible(nextVisible: boolean) {
  if (visible === nextVisible) return
  visible = nextVisible
  listeners.forEach((listener) => listener())
}

export function subscribeToSignerApproval(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSignerApprovalSnapshot() {
  return visible
}

export function dismissSignerApproval() {
  dismissed = true
  setVisible(false)
}

function scheduleShow() {
  timer = setTimeout(() => {
    timer = null
    if (pending > 0 && !dismissed) {
      setVisible(true)
    }
  }, SHOW_DELAY_MS)
}

function hide() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  setVisible(false)
}

export async function withSignerApproval<T>(promise: Promise<T>, timeout = TIMEOUT_MS): Promise<T> {
  if (pending === 0) {
    dismissed = false
    scheduleShow()
  }
  pending++

  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(
      () => reject(new Error(i18n.t('Signer did not respond in time'))),
      timeout
    )
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutTimer)
    pending--
    if (pending === 0) {
      hide()
    }
  }
}
