import { afterEach, describe, expect, it, vi } from 'vitest'

describe('signer approval status', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('appears after a delay and hides when signing finishes', async () => {
    vi.useFakeTimers()
    const signerApproval = await import('./signer-approval')
    let resolveSigning!: (value: string) => void
    const signing = signerApproval.withSignerApproval(
      new Promise<string>((resolve) => {
        resolveSigning = resolve
      })
    )

    expect(signerApproval.getSignerApprovalSnapshot()).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(signerApproval.getSignerApprovalSnapshot()).toBe(true)

    resolveSigning('signed')
    await expect(signing).resolves.toBe('signed')
    expect(signerApproval.getSignerApprovalSnapshot()).toBe(false)
  })

  it('stays hidden for the current batch after being dismissed', async () => {
    vi.useFakeTimers()
    const signerApproval = await import('./signer-approval')
    let resolveSigning!: () => void
    const signing = signerApproval.withSignerApproval(
      new Promise<void>((resolve) => {
        resolveSigning = resolve
      })
    )

    await vi.advanceTimersByTimeAsync(1_000)
    signerApproval.dismissSignerApproval()
    expect(signerApproval.getSignerApprovalSnapshot()).toBe(false)

    let resolveConcurrentSigning!: () => void
    const concurrentSigning = signerApproval.withSignerApproval(
      new Promise<void>((resolve) => {
        resolveConcurrentSigning = resolve
      })
    )
    await vi.advanceTimersByTimeAsync(1_000)
    expect(signerApproval.getSignerApprovalSnapshot()).toBe(false)

    resolveSigning()
    resolveConcurrentSigning()
    await Promise.all([signing, concurrentSigning])

    let resolveNextSigning!: () => void
    const nextSigning = signerApproval.withSignerApproval(
      new Promise<void>((resolve) => {
        resolveNextSigning = resolve
      })
    )
    await vi.advanceTimersByTimeAsync(1_000)
    expect(signerApproval.getSignerApprovalSnapshot()).toBe(true)

    resolveNextSigning()
    await nextSigning
  })
})
