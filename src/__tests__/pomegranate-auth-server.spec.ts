import {
  PomegranateAuthServer,
  parsePomegranateAuthUrl
} from '../../electron/main/pomegranate-auth-server'
import { afterEach, describe, expect, it } from 'vitest'

let server: PomegranateAuthServer | null = null

afterEach(() => {
  server?.stop()
  server = null
})

describe('parsePomegranateAuthUrl', () => {
  it('accepts Google login and operator recovery endpoints', () => {
    expect(parsePomegranateAuthUrl('https://auth.njump.me/login/google').origin).toBe(
      'https://auth.njump.me'
    )
    expect(parsePomegranateAuthUrl('https://po.jumble.social/po/recover/google/').pathname).toBe(
      '/po/recover/google/'
    )
  })

  it('rejects unrelated and unsafe URLs', () => {
    expect(() => parsePomegranateAuthUrl('https://example.com/account')).toThrow()
    expect(() => parsePomegranateAuthUrl('file:///login/google')).toThrow()
    expect(() => parsePomegranateAuthUrl('https://user:pass@example.com/login/google')).toThrow()
  })
})

describe('PomegranateAuthServer', () => {
  it('bridges a system-browser result back to the pending authentication', async () => {
    let openedUrl = ''
    let openedResolve: (() => void) | undefined
    const opened = new Promise<void>((resolve) => {
      openedResolve = resolve
    })
    server = new PomegranateAuthServer(async (url) => {
      openedUrl = url
      openedResolve?.()
    })

    const auth = server.authenticate('https://auth.njump.me/login/google')
    await opened

    const startResponse = await fetch(openedUrl)
    expect(startResponse.ok).toBe(true)
    const startPage = await startResponse.text()
    expect(startPage).toContain('https://auth.njump.me/login/google')
    expect(startPage).toContain('Waiting for authorization…')
    expect(startPage).toContain('Continue with Google')
    expect(startPage).toContain('Sign in to Jumble')
    expect(startPage).toContain(
      'Jumble needs Google authorization to verify your identity and sign you in'
    )
    expect(startPage).toContain('How it works')
    expect(startPage).toContain(
      'Your private key is split into shards held by separate, independent operators'
    )
    expect(startPage).toContain(
      'Google is only used to prove your identity to the operators, never to store your key'
    )
    expect(startPage).not.toContain('class="brand"')
    expect(startPage).toContain('authDescription.hidden = true')
    expect(startPage).toContain('securityNote.hidden = true')
    expect(startPage).toContain("title.classList.add('complete')")
    expect(startPage).toContain('Recovery operators')
    expect(startPage).toContain('Recovering…')
    expect(startPage).not.toContain('openAuth();')

    const startUrl = new URL(openedUrl)
    const completeResponse = await fetch(`${openedUrl}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'signed-token' })
    })
    expect(completeResponse.ok).toBe(true)
    expect(startUrl.hostname).toBe('127.0.0.1')
    await expect(auth).resolves.toBe('signed-token')
  })

  it('describes the requested Google authorization purpose', async () => {
    let openedUrl = ''
    let openedResolve: (() => void) | undefined
    const opened = new Promise<void>((resolve) => {
      openedResolve = resolve
    })
    server = new PomegranateAuthServer(async (url) => {
      openedUrl = url
      openedResolve?.()
    })

    const auth = server.authenticate('https://auth.njump.me/login/google', 'bind')
    await opened

    const page = await (await fetch(openedUrl)).text()
    expect(page).toContain('Connect Google to Jumble')
    expect(page).toContain('link this Nostr account for secure sign-in and account recovery')

    await postResult(openedUrl, 'signed-token')
    await expect(auth).resolves.toBe('signed-token')
  })

  it('lets the user choose operators and resolves after reaching the threshold', async () => {
    let openedUrl = ''
    let openedResolve: (() => void) | undefined
    const opened = new Promise<void>((resolve) => {
      openedResolve = resolve
    })
    const expectedPubkey = 'a'.repeat(64)
    server = new PomegranateAuthServer(
      async (url) => {
        openedUrl = url
        openedResolve?.()
      },
      async (_centralOrigin, token) => {
        expect(token).toBe('central-token')
        return {
          pubkey: expectedPubkey,
          threshold: 2,
          operators: [
            { url: 'https://operator-one.example', pubshard: 'shard-one:' },
            { url: 'https://operator-two.example', pubshard: 'shard-two:' },
            { url: 'https://operator-three.example', pubshard: 'shard-three:' }
          ]
        }
      }
    )

    const recovery = server.recover('https://auth.njump.me/login/google', expectedPubkey)
    await opened

    const centralResponse = await postResult(openedUrl, 'central-token')
    expect(centralResponse).toMatchObject({
      done: false,
      recovered: 0,
      required: 2,
      operators: [
        {
          index: 0,
          label: 'operator-one.example',
          url: 'https://operator-one.example/po/recover/google',
          recovered: false
        },
        {
          index: 1,
          label: 'operator-two.example',
          recovered: false
        },
        {
          index: 2,
          label: 'operator-three.example',
          recovered: false
        }
      ]
    })

    const resumedPage = await (await fetch(openedUrl)).text()
    expect(resumedPage).toContain('const initialRecoveryState = {')
    expect(resumedPage).toContain('Recover your private key')
    expect(resumedPage).toContain('request the key shards required for recovery')
    expect(resumedPage).toContain('operator-three.example')

    const firstOperatorResponse = await postResult(openedUrl, 'shard-three:secret', 2)
    expect(firstOperatorResponse).toMatchObject({
      done: false,
      recovered: 1,
      required: 2,
      operators: [
        { index: 0, recovered: false },
        { index: 1, recovered: false },
        { index: 2, recovered: true }
      ]
    })

    await expect(postResult(openedUrl, 'shard-one:secret', 0)).resolves.toEqual({ done: true })
    await expect(recovery).resolves.toEqual({
      shards: ['shard-three:secret', 'shard-one:secret']
    })
  })
})

async function postResult(
  startUrl: string,
  value: string,
  operatorIndex?: number
): Promise<unknown> {
  const response = await fetch(`${startUrl}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(operatorIndex === undefined ? { value } : { value, operatorIndex })
  })
  expect(response.ok).toBe(true)
  return response.json()
}
