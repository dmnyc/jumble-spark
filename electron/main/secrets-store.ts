import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TSecretsBundle } from '../shared/ipc-types.js'
import type { StoreCrypto } from './store-crypto.js'

const FILE_NAME = 'secrets.enc'

export class SecretsStore {
  private filePath: string
  private writeChain: Promise<void> = Promise.resolve()
  private loadPromise: Promise<TSecretsBundle> | null = null

  constructor(private readonly crypto: StoreCrypto) {
    this.filePath = path.join(app.getPath('userData'), FILE_NAME)
  }

  isAvailable(): boolean {
    return this.crypto.isReady()
  }

  preload(): Promise<TSecretsBundle> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk().catch((error) => {
        this.loadPromise = null
        throw error
      })
    }
    return this.loadPromise
  }

  load(): Promise<TSecretsBundle> {
    return this.preload()
  }

  private async loadFromDisk(): Promise<TSecretsBundle> {
    if (!this.crypto.isReady()) {
      throw new Error('store crypto not ready — cannot decrypt secrets')
    }
    let buf: Buffer
    try {
      buf = await fs.readFile(this.filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
    if (buf.length === 0) return {}
    const text = this.crypto.decrypt(buf)
    if (!text) return {}
    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' ? (parsed as TSecretsBundle) : {}
    } catch {
      return {}
    }
  }

  // Serialize writes so concurrent saves don't trample each other.
  save(bundle: TSecretsBundle): Promise<void> {
    const next = this.writeChain.then(() => this.writeNow(bundle))
    this.writeChain = next.catch(() => {
      // swallow so chain stays alive
    })
    return next
  }

  /** Delete the encrypted file (used when resetting a forgotten password). */
  async deleteAll(): Promise<void> {
    this.loadPromise = null
    await fs.rm(this.filePath, { force: true })
    await fs.rm(`${this.filePath}.tmp`, { force: true })
  }

  private async writeNow(bundle: TSecretsBundle): Promise<void> {
    if (!this.crypto.isReady()) {
      throw new Error('store crypto not ready — refusing to write secrets in plaintext')
    }
    const json = JSON.stringify(bundle ?? {})
    const cipher = this.crypto.encrypt(json)
    const tmp = `${this.filePath}.tmp`
    await fs.writeFile(tmp, cipher, { mode: 0o600 })
    await fs.rename(tmp, this.filePath)
  }
}
