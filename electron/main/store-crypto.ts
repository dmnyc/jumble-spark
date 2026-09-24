import { safeStorage } from 'electron'
import type { PasswordCrypto } from './password-crypto.js'

/**
 * Encryption layer backing the on-disk stores (secrets.enc,
 * renderer-state.enc). Two implementations exist: the OS keychain via
 * Electron's safeStorage (preferred), and a password-derived key
 * (PasswordCrypto) for environments without a desktop keyring.
 */
export interface StoreCrypto {
  /** True when encrypt/decrypt are usable right now. */
  isReady(): boolean
  encrypt(plaintext: string): Buffer
  decrypt(data: Buffer): string
}

export class SafeStorageCrypto implements StoreCrypto {
  isReady(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  encrypt(plaintext: string): Buffer {
    return safeStorage.encryptString(plaintext)
  }

  decrypt(data: Buffer): string {
    return safeStorage.decryptString(data)
  }
}

/**
 * Active backend is the password store, but existing files may still be
 * safeStorage-encrypted (e.g. the keychain became available again after the
 * password backend was chosen). Reads accept both formats; writes always use
 * the password backend, so files converge to it on the next save.
 */
export class MigratingStoreCrypto implements StoreCrypto {
  constructor(
    private readonly active: PasswordCrypto,
    private readonly legacy: StoreCrypto
  ) {}

  isReady(): boolean {
    return this.active.isReady()
  }

  encrypt(plaintext: string): Buffer {
    return this.active.encrypt(plaintext)
  }

  decrypt(data: Buffer): string {
    if (this.active.isEncryptedBuffer(data)) {
      return this.active.decrypt(data)
    }
    return this.legacy.decrypt(data)
  }
}
