import { PasswordCrypto } from '../../electron/main/password-crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jumble-password-crypto-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('PasswordCrypto', () => {
  it('encrypts and decrypts after setup', async () => {
    const pc = new PasswordCrypto(dir)
    expect(pc.isReady()).toBe(false)
    expect(await pc.hasParams()).toBe(false)

    await pc.setup('correct horse battery staple')
    expect(pc.isReady()).toBe(true)
    expect(await pc.hasParams()).toBe(true)

    const plaintext = '{"nsec":{"pubkey1":"nsec1secret"}}'
    const encrypted = pc.encrypt(plaintext)
    expect(pc.isEncryptedBuffer(encrypted)).toBe(true)
    expect(encrypted.includes(Buffer.from(plaintext))).toBe(false)
    expect(pc.decrypt(encrypted)).toBe(plaintext)
  })

  it('unlocks a fresh instance with the same password and rejects wrong ones', async () => {
    const first = new PasswordCrypto(dir)
    await first.setup('hunter2hunter2')
    const encrypted = first.encrypt('secret')

    const second = new PasswordCrypto(dir)
    expect(second.isReady()).toBe(false)
    expect(await second.hasParams()).toBe(true)

    expect(await second.unlock('wrong-password')).toBe(false)
    expect(second.isReady()).toBe(false)
    expect(() => second.encrypt('x')).toThrow()

    expect(await second.unlock('hunter2hunter2')).toBe(true)
    expect(second.decrypt(encrypted)).toBe('secret')
  })

  it('refuses to set up twice', async () => {
    const pc = new PasswordCrypto(dir)
    await pc.setup('password-one')
    await expect(pc.setup('password-two')).rejects.toThrow()
  })

  it('rejects tampered ciphertext', async () => {
    const pc = new PasswordCrypto(dir)
    await pc.setup('correct horse battery staple')
    const encrypted = pc.encrypt('secret')
    encrypted[encrypted.length - 1] ^= 0xff
    expect(() => pc.decrypt(encrypted)).toThrow()
  })

  it('rejects data without the password magic prefix', async () => {
    const pc = new PasswordCrypto(dir)
    await pc.setup('correct horse battery staple')
    expect(() => pc.decrypt(Buffer.from('safe-storage-encrypted-blob'))).toThrow()
  })

  it('rejects unlock when the KDF params file was tampered with', async () => {
    const pc = new PasswordCrypto(dir)
    await pc.setup('correct horse battery staple')

    const paramsPath = path.join(dir, 'password-kdf.json')
    const params = JSON.parse(await fs.readFile(paramsPath, 'utf8'))
    params.N = 1 << 30 // way beyond the accepted range
    await fs.writeFile(paramsPath, JSON.stringify(params))

    const tampered = new PasswordCrypto(dir)
    expect(await tampered.unlock('correct horse battery staple')).toBe(false)
    expect(tampered.isReady()).toBe(false)
  })

  it('reset forgets the key and deletes the params file', async () => {
    const pc = new PasswordCrypto(dir)
    await pc.setup('correct horse battery staple')
    expect(await pc.hasParams()).toBe(true)

    await pc.reset()
    expect(pc.isReady()).toBe(false)
    expect(await pc.hasParams()).toBe(false)

    const fresh = new PasswordCrypto(dir)
    expect(await fresh.hasParams()).toBe(false)
    expect(await fresh.unlock('correct horse battery staple')).toBe(false)
  })
})
