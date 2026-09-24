import {
  collectSafeLocalStorageEntries,
  ELECTRON_STORAGE_REVISION_KEY,
  shouldRestoreLocalStorage
} from '@/lib/electron-local-storage'
import { describe, expect, it } from 'vitest'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('Electron localStorage snapshots', () => {
  it('restores only snapshots newer than Chromium storage', () => {
    const storage = new MemoryStorage()
    storage.setItem(ELECTRON_STORAGE_REVISION_KEY, '10')

    expect(shouldRestoreLocalStorage(storage, { version: 1, revision: 11, entries: {} })).toBe(true)
    expect(shouldRestoreLocalStorage(storage, { version: 1, revision: 10, entries: {} })).toBe(
      false
    )
    expect(shouldRestoreLocalStorage(storage, { version: 1, revision: 9, entries: {} })).toBe(false)
  })

  it('backs up preferences while stripping every secret account field', () => {
    const storage = new MemoryStorage()
    storage.setItem('themeSetting', 'dark')
    storage.setItem('encryptionKeyPrivkeyMap', '{"secret":"value"}')
    storage.setItem(
      'accounts',
      JSON.stringify([
        {
          pubkey: 'pubkey',
          signerType: 'bunker',
          bunker: 'bunker://operator',
          nsec: 'nsec-secret',
          ncryptsec: 'ncryptsec-secret',
          bunkerClientSecretKey: 'bunker-secret'
        }
      ])
    )

    const entries = collectSafeLocalStorageEntries(storage)
    const accounts = JSON.parse(entries.accounts) as Record<string, unknown>[]

    expect(entries.themeSetting).toBe('dark')
    expect(entries.encryptionKeyPrivkeyMap).toBeUndefined()
    expect(accounts).toEqual([
      { pubkey: 'pubkey', signerType: 'bunker', bunker: 'bunker://operator' }
    ])
  })
})
