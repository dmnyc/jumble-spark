import { describe, expect, it } from 'vitest'
import { fitsNip46Request, getNip46RequestBytes, NIP46_MAX_REQUEST_BYTES } from './nip46'

const pubkey = 'ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74'

describe('NIP-46 request size', () => {
  it('fits an ordinary decrypt request', () => {
    expect(fitsNip46Request('nip44_decrypt', [pubkey, 'A'.repeat(2_000)])).toBe(true)
  })

  it('rejects decrypting a mute list with hundreds of private items', () => {
    // The size of a real 593-item private mute list's NIP-44 content
    expect(fitsNip46Request('nip44_decrypt', [pubkey, 'A'.repeat(65_628)])).toBe(false)
  })

  it('rejects signing a follow list over the limit', () => {
    const followList = {
      kind: 3,
      pubkey,
      created_at: 1_790_000_000,
      content: '',
      tags: Array.from({ length: 1_000 }, () => ['p', pubkey])
    }
    const params = [JSON.stringify(followList)]
    expect(getNip46RequestBytes('sign_event', params)).toBeGreaterThan(NIP46_MAX_REQUEST_BYTES)
    expect(fitsNip46Request('sign_event', params)).toBe(false)
  })
})
