import { MediaManagerService } from '@/services/media-manager.service'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FakeMedia = HTMLMediaElement & {
  rejectPlay: (error: Error) => void
}

function createMedia(paused = true, isConnected = true): FakeMedia {
  let rejectPlay: (error: Error) => void = () => undefined
  const media = {
    currentTime: 0,
    paused,
    isConnected,
    ended: false,
    readyState: 0,
    play: vi.fn(() => {
      media.paused = false
      return new Promise<void>((_, reject) => {
        rejectPlay = reject
      })
    }),
    pause: vi.fn(() => {
      media.paused = true
      rejectPlay(new DOMException('Playback was interrupted', 'AbortError'))
    }),
    rejectPlay: (error: Error) => rejectPlay(error)
  }
  return media as unknown as FakeMedia
}

describe('MediaManagerService', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function createManager() {
    vi.stubGlobal('document', { pictureInPictureElement: null })
    return new MediaManagerService()
  }

  it('waits to autoplay the next visible media until the current media stops', () => {
    const manager = createManager()
    const current = createMedia()
    const next = createMedia()

    manager.play(current)
    manager.autoPlay(next)

    expect(current.pause).not.toHaveBeenCalled()
    expect(next.play).not.toHaveBeenCalled()

    manager.pause(current)

    expect(next.play).toHaveBeenCalledOnce()
  })

  it('does not autoplay a queued media item that is no longer eligible', () => {
    const manager = createManager()
    const current = createMedia()
    const next = createMedia()
    let isVisible = true

    manager.play(current)
    manager.autoPlay(next, () => isVisible)
    isVisible = false
    manager.pause(current)

    expect(next.play).not.toHaveBeenCalled()
  })

  it('releases detached media before evaluating a new autoplay request', () => {
    const manager = createManager()
    const detachedAudio = createMedia(false, false)
    const next = createMedia()

    manager.registerPlaying(detachedAudio)
    manager.autoPlay(next)

    expect(next.play).toHaveBeenCalledOnce()
  })

  it('keeps the new media active when an old play promise aborts', async () => {
    const manager = createManager()
    const first = createMedia()
    const second = createMedia()
    const third = createMedia()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    manager.play(first)
    manager.play(second)
    await Promise.resolve()
    manager.autoPlay(third)

    expect(first.pause).toHaveBeenCalledOnce()
    expect(second.pause).not.toHaveBeenCalled()
    expect(third.play).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('keeps a retry active when an earlier request for the same media aborts', async () => {
    const manager = createManager()
    const media = createMedia()
    const autoPlayCandidate = createMedia()

    manager.play(media)
    manager.pause(media)
    manager.play(media)
    await Promise.resolve()
    manager.autoPlay(autoPlayCandidate)

    expect(media.play).toHaveBeenCalledTimes(2)
    expect(autoPlayCandidate.play).not.toHaveBeenCalled()
  })

  it('registers native playback without issuing a duplicate play request', () => {
    const manager = createManager()
    const first = createMedia(false)
    const second = createMedia(false)
    const autoPlayCandidate = createMedia()

    manager.registerPlaying(first)
    manager.registerPlaying(second)
    manager.autoPlay(autoPlayCandidate)

    expect(first.pause).toHaveBeenCalledOnce()
    expect(first.play).not.toHaveBeenCalled()
    expect(second.play).not.toHaveBeenCalled()
    expect(autoPlayCandidate.play).not.toHaveBeenCalled()
  })
})
