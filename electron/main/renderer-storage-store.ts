import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { TLocalStorageSnapshot } from '../shared/ipc-types.js'
import type { StoreCrypto } from './store-crypto.js'

const FILE_NAME = 'renderer-state.enc'
const BACKUP_FILE_NAME = 'renderer-state.enc.bak'

function isSnapshot(value: unknown): value is TLocalStorageSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<TLocalStorageSnapshot>
  if (
    snapshot.version !== 1 ||
    typeof snapshot.revision !== 'number' ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !snapshot.entries ||
    typeof snapshot.entries !== 'object' ||
    Array.isArray(snapshot.entries)
  ) {
    return false
  }
  return Object.entries(snapshot.entries).every(
    ([key, entryValue]) => typeof key === 'string' && typeof entryValue === 'string'
  )
}

export class RendererStorageStore {
  private readonly filePath: string
  private readonly backupPath: string
  private writeChain: Promise<void> = Promise.resolve()
  private loadPromise: Promise<TLocalStorageSnapshot | null> | null = null

  constructor(private readonly crypto: StoreCrypto) {
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, FILE_NAME)
    this.backupPath = path.join(userDataPath, BACKUP_FILE_NAME)
  }

  preload(): Promise<TLocalStorageSnapshot | null> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk().catch((error) => {
        this.loadPromise = null
        throw error
      })
    }
    return this.loadPromise
  }

  load(): Promise<TLocalStorageSnapshot | null> {
    return this.preload()
  }

  private async loadFromDisk(): Promise<TLocalStorageSnapshot | null> {
    if (!this.crypto.isReady()) return null

    let primaryError: unknown
    try {
      return await this.readSnapshot(this.filePath)
    } catch (error) {
      primaryError = error
    }

    try {
      return await this.readSnapshot(this.backupPath)
    } catch (backupError) {
      if (this.isMissingFileError(primaryError) && this.isMissingFileError(backupError)) return null
      throw primaryError ?? backupError
    }
  }

  save(snapshot: TLocalStorageSnapshot): Promise<void> {
    if (!isSnapshot(snapshot)) return Promise.reject(new Error('Invalid renderer storage snapshot'))
    const next = this.writeChain.then(() => this.writeNow(snapshot))
    this.writeChain = next.catch(() => {
      // Keep the queue usable after a failed write.
    })
    return next
  }

  flush(): Promise<void> {
    return this.writeChain
  }

  private async readSnapshot(filePath: string): Promise<TLocalStorageSnapshot> {
    const encrypted = await fs.readFile(filePath)
    const plaintext = this.crypto.decrypt(encrypted)
    const parsed: unknown = JSON.parse(plaintext)
    if (!isSnapshot(parsed)) throw new Error('Invalid renderer storage snapshot')
    return parsed
  }

  /** Delete all snapshot files (used when resetting a forgotten password). */
  async deleteAll(): Promise<void> {
    this.loadPromise = null
    await fs.rm(this.filePath, { force: true })
    await fs.rm(`${this.filePath}.tmp`, { force: true })
    await fs.rm(this.backupPath, { force: true })
    await fs.rm(`${this.backupPath}.tmp`, { force: true })
  }

  private async writeNow(snapshot: TLocalStorageSnapshot): Promise<void> {
    if (!this.crypto.isReady()) {
      throw new Error('store crypto not ready — refusing to persist renderer state')
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await this.backUpCurrentFile()

    const encrypted = this.crypto.encrypt(JSON.stringify(snapshot))
    const temporaryPath = `${this.filePath}.tmp`
    const handle = await fs.open(temporaryPath, 'w', 0o600)
    try {
      await handle.writeFile(encrypted)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(temporaryPath, this.filePath)
  }

  private async backUpCurrentFile(): Promise<void> {
    try {
      // Only rotate a snapshot that can still be decrypted and validated.
      await this.readSnapshot(this.filePath)
      const temporaryBackupPath = `${this.backupPath}.tmp`
      await fs.copyFile(this.filePath, temporaryBackupPath)
      await fs.rename(temporaryBackupPath, this.backupPath)
    } catch {
      // A missing or corrupt primary must never replace the last good backup.
    }
  }

  private isMissingFileError(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
  }
}
