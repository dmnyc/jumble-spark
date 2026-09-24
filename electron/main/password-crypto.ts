import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { StoreCrypto } from './store-crypto.js'

/**
 * Password-based encryption backend for the on-disk stores (secrets.enc,
 * renderer-state.enc). Used when Electron's safeStorage is unavailable —
 * typically Linux without a desktop keyring. The key is derived from a
 * user-provided password with scrypt and held in memory only; ciphertext
 * files carry a magic prefix so they are distinguishable from
 * safeStorage-encrypted files.
 *
 * This module deliberately avoids importing 'electron' so it stays
 * unit-testable under plain Node.
 */

const MAGIC = Buffer.from('JUMBLE-PW1\n', 'utf8')
const KDF_PARAMS_FILE_NAME = 'password-kdf.json'
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
// 128 * N * r (= 32 MiB) exceeds Node's default scrypt maxmem, so raise it.
const SCRYPT_MAXMEM = 128 * 1024 * 1024
const KEY_LENGTH = 32
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const VERIFIER_PLAINTEXT = 'jumble-password-verifier-v1'

type TKdfParamsFile = {
  v: 1
  kdf: 'scrypt'
  N: number
  r: number
  p: number
  /** base64 */
  salt: string
  /** base64; VERIFIER_PLAINTEXT encrypted with the derived key */
  verifier: string
}

function isKdfParamsFile(value: unknown): value is TKdfParamsFile {
  const v = value as Partial<TKdfParamsFile> | null
  return (
    !!v &&
    v.v === 1 &&
    v.kdf === 'scrypt' &&
    typeof v.N === 'number' &&
    typeof v.r === 'number' &&
    typeof v.p === 'number' &&
    typeof v.salt === 'string' &&
    typeof v.verifier === 'string'
  )
}

// The KDF params file lives in userData, which a local attacker could tamper
// with (e.g. a huge N to exhaust memory at unlock). Only accept sane ranges.
const MIN_SCRYPT_N = 1 << 10
const MAX_SCRYPT_N = 1 << 20

function isSaneKdfParams(params: TKdfParamsFile): boolean {
  const { N, r, p } = params
  return (
    Number.isInteger(N) &&
    N >= MIN_SCRYPT_N &&
    N <= MAX_SCRYPT_N &&
    (N & (N - 1)) === 0 && // scrypt requires a power of two
    Number.isInteger(r) &&
    r >= 1 &&
    r <= 32 &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= 16
  )
}

function deriveKey(
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: SCRYPT_MAXMEM }, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

export class PasswordCrypto implements StoreCrypto {
  private key: Buffer | null = null
  private params: TKdfParamsFile | null = null
  private readonly paramsPath: string

  constructor(userDataDir: string) {
    this.paramsPath = path.join(userDataDir, KDF_PARAMS_FILE_NAME)
  }

  isReady(): boolean {
    return this.key !== null
  }

  /** True once the user has created a password on this machine. */
  async hasParams(): Promise<boolean> {
    return (await this.readParams()) !== null
  }

  isEncryptedBuffer(data: Buffer): boolean {
    return data.length >= MAGIC.length && data.subarray(0, MAGIC.length).equals(MAGIC)
  }

  /** Create a new password. Must only be called when no params exist yet. */
  async setup(password: string): Promise<void> {
    if (await this.hasParams()) {
      throw new Error('password already set')
    }
    const salt = crypto.randomBytes(16)
    const key = await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
    const params: TKdfParamsFile = {
      v: 1,
      kdf: 'scrypt',
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      salt: salt.toString('base64'),
      verifier: encryptWithKey(key, VERIFIER_PLAINTEXT).toString('base64')
    }
    const tmp = `${this.paramsPath}.tmp`
    await fs.writeFile(tmp, JSON.stringify(params), { mode: 0o600 })
    await fs.rename(tmp, this.paramsPath)
    this.params = params
    this.key = key
  }

  /** Derive the key and verify it against the stored verifier. */
  async unlock(password: string): Promise<boolean> {
    const params = await this.readParams()
    if (!params || !isSaneKdfParams(params)) return false
    const key = await deriveKey(
      password,
      Buffer.from(params.salt, 'base64'),
      params.N,
      params.r,
      params.p
    )
    try {
      if (decryptWithKey(key, Buffer.from(params.verifier, 'base64')) !== VERIFIER_PLAINTEXT) {
        key.fill(0)
        return false
      }
    } catch {
      key.fill(0)
      return false
    }
    this.key = key
    return true
  }

  /** Forget the derived key and delete the KDF params (used by "reset"). */
  async reset(): Promise<void> {
    this.key?.fill(0)
    this.key = null
    this.params = null
    await fs.rm(this.paramsPath, { force: true })
    await fs.rm(`${this.paramsPath}.tmp`, { force: true })
  }

  encrypt(plaintext: string): Buffer {
    if (!this.key) throw new Error('password store is locked')
    return encryptWithKey(this.key, plaintext)
  }

  decrypt(data: Buffer): string {
    if (!this.key) throw new Error('password store is locked')
    if (!this.isEncryptedBuffer(data)) {
      throw new Error('data is not password-encrypted')
    }
    return decryptWithKey(this.key, data)
  }

  private async readParams(): Promise<TKdfParamsFile | null> {
    if (this.params) return this.params
    let raw: string
    try {
      raw = await fs.readFile(this.paramsPath, 'utf8')
    } catch {
      return null
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isKdfParamsFile(parsed)) return null
      this.params = parsed
      return parsed
    } catch {
      return null
    }
  }
}

function encryptWithKey(key: Buffer, plaintext: string): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext])
}

function decryptWithKey(key: Buffer, data: Buffer): string {
  const headerLength = MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH
  if (data.length < headerLength) throw new Error('truncated password-encrypted data')
  const iv = data.subarray(MAGIC.length, MAGIC.length + IV_LENGTH)
  const tag = data.subarray(MAGIC.length + IV_LENGTH, headerLength)
  const ciphertext = data.subarray(headerLength)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
