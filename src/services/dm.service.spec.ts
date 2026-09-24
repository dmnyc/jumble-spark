import { ExtendedKind } from '@/constants'
import { TDmMessage } from '@/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  getDmMessageById: vi.fn(),
  getDmMessages: vi.fn(),
  getDmConversation: vi.fn()
}))

vi.mock('./indexed-db.service', () => ({ default: db }))
vi.mock('./client.service', () => ({ default: {} }))
vi.mock('./crypto-file.service', () => ({ default: {} }))
vi.mock('./encryption-key.service', () => ({ default: {} }))
vi.mock('./local-storage.service', () => ({ default: {} }))
vi.mock('./nip17-gift-wrap.service', () => ({ default: {} }))

import dmService from './dm.service'

const participantsKey = 'alice:bob'
const imageMessage = {
  id: 'image',
  participantsKey,
  senderPubkey: 'alice',
  content: 'https://example.com/encrypted-file',
  decryptedRumor: { kind: ExtendedKind.RUMOR_FILE, tags: [['file-type', 'image/png']] }
} as TDmMessage

describe('DM reply previews', () => {
  const subscriptions = new Set<() => void>()
  const cleanups: (() => void)[] = []
  const dataChanged = () => subscriptions.forEach((listener) => listener())
  const flush = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }
  const watch = (listener: (message: TDmMessage | null) => void, id = 'image') => {
    const stop = dmService.watchReplyTo(id, participantsKey, listener)
    cleanups.push(stop)
    return stop
  }

  beforeEach(() => {
    vi.resetAllMocks()
    subscriptions.clear()
    vi.spyOn(dmService, 'onDataChanged').mockImplementation((listener) => {
      subscriptions.add(listener)
      return () => {
        subscriptions.delete(listener)
      }
    })
    db.getDmMessageById.mockResolvedValue(null)
  })

  afterEach(() => {
    cleanups.splice(0).forEach((stop) => stop())
    vi.restoreAllMocks()
  })

  it('fills an unresolved quote when the image arrives after the reply', async () => {
    const listener = vi.fn()
    watch(listener)
    await flush()
    expect(listener).toHaveBeenLastCalledWith(null)

    db.getDmMessageById.mockResolvedValue(imageMessage)
    dataChanged()
    await flush()
    expect(listener).toHaveBeenLastCalledWith(imageMessage)
    expect(dmService.getFilePreviewContent(imageMessage.decryptedRumor.tags)).toBe('[Image]')
  })

  it('looks up the original message even when a stored reply has an old preview snapshot', async () => {
    const legacyReply = {
      id: 'reply',
      participantsKey,
      replyTo: { id: 'image', content: 'outdated preview', senderPubkey: 'bob' }
    }
    db.getDmMessages.mockResolvedValue([legacyReply])
    db.getDmConversation.mockResolvedValue(null)
    db.getDmMessageById.mockResolvedValue(imageMessage)
    const [reply] = await dmService.getMessages('alice', 'bob')
    const listener = vi.fn()
    watch(listener, reply.replyTo!.id)
    await flush()

    expect(db.getDmMessageById).toHaveBeenCalledWith('image')
    expect(listener).toHaveBeenLastCalledWith(imageMessage)
  })

  it('does not replace a newer result with a stale lookup', async () => {
    let finishFirst!: (message: TDmMessage | null) => void
    db.getDmMessageById.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve))
    )
    const listener = vi.fn()
    watch(listener)
    db.getDmMessageById.mockResolvedValue(imageMessage)
    dataChanged()
    await flush()
    finishFirst(null)
    await flush()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(imageMessage)
  })

  it('stops querying and ignores pending results after unsubscribing', async () => {
    db.getDmMessageById.mockResolvedValue(imageMessage)
    const listener = vi.fn()
    const stop = watch(listener)
    stop()
    await flush()
    dataChanged()
    await flush()

    expect(listener).not.toHaveBeenCalled()
    expect(db.getDmMessageById).toHaveBeenCalledTimes(1)
  })

  it('does not preview a message from a different conversation', async () => {
    db.getDmMessageById.mockResolvedValue({ ...imageMessage, participantsKey: 'alice:charlie' })
    const listener = vi.fn()
    watch(listener)
    await flush()
    expect(listener).toHaveBeenLastCalledWith(null)
  })

  it('retries after a failed database lookup', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.getDmMessageById.mockRejectedValueOnce(new Error('database unavailable'))
    const listener = vi.fn()
    watch(listener)
    await flush()
    expect(listener).toHaveBeenLastCalledWith(null)

    db.getDmMessageById.mockResolvedValue(imageMessage)
    dataChanged()
    await flush()
    expect(listener).toHaveBeenLastCalledWith(imageMessage)
  })
})
