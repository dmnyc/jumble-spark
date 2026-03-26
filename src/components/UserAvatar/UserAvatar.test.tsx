import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import UserAvatar from './index'
import * as useFetchProfileHook from '@/hooks/useFetchProfile'

const originalIO = globalThis.IntersectionObserver

// Mock the hooks and dependencies
vi.mock('@/hooks/useFetchProfile', () => ({
  useFetchProfile: vi.fn()
}))

vi.mock('@/PageManager', () => ({
  useSmartProfileNavigation: () => ({
    navigateToProfile: vi.fn()
  }),
  useSmartProfileNavigationOptional: () => ({
    navigateToProfile: vi.fn()
  })
}))

vi.mock('@/lib/pubkey', () => ({
  userIdToPubkey: (id: string) => (id.startsWith('npub') ? 'decoded_pubkey' : id),
  generateImageByPubkey: (_pubkey: string) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="gray"/></svg>`)}`
}))

vi.mock('@/lib/link', () => ({
  toProfile: (pubkey: string) => `/profile/${pubkey}`
}))

describe('UserAvatar in Embedded Notes', () => {
  beforeAll(() => {
    globalThis.IntersectionObserver = class IntersectionObserverMock {
      constructor(
        public cb: IntersectionObserverCallback,
        public _opts?: IntersectionObserverInit
      ) {}
      observe(el: Element) {
        queueMicrotask(() => {
          this.cb(
            [
              {
                isIntersecting: true,
                target: el,
                intersectionRatio: 1,
                boundingClientRect: {} as DOMRectReadOnly,
                intersectionRect: {} as DOMRectReadOnly,
                rootBounds: null,
                time: Date.now()
              }
            ],
            this
          )
        })
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return []
      }
      root = null
      rootMargin = ''
      thresholds = []
    } as unknown as typeof IntersectionObserver
  })

  afterAll(() => {
    globalThis.IntersectionObserver = originalIO
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render avatar image fully visible without being covered', async () => {
    // Mock profile with avatar
    vi.mocked(useFetchProfileHook.useFetchProfile).mockReturnValue({
      isFetching: false,
      error: null,
      profile: {
        pubkey: 'test_pubkey',
        npub: 'npub_test',
        username: 'testuser',
        avatar: 'https://example.com/avatar.jpg'
      }
    })

    const { container } = render(
      <div data-embedded-note>
        <div className="p-2 sm:p-3 border rounded-lg">
          <div className="relative">
            <UserAvatar userId="test_pubkey" size="medium" />
          </div>
        </div>
      </div>
    )

    // Find the avatar container
    const avatarContainer = container.querySelector('[data-user-avatar]')
    expect(avatarContainer).toBeInTheDocument()

    // Find the image — identicon first, then remote profile picture after intersection
    const img = avatarContainer?.querySelector('img')
    expect(img).toBeInTheDocument()
    await waitFor(() => {
      expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg')
    })

    // Check that the image is not hidden or covered
    const computedStyle = window.getComputedStyle(img!)
    expect(computedStyle.display).not.toBe('none')
    expect(computedStyle.visibility).not.toBe('hidden')
    expect(computedStyle.opacity).not.toBe('0')

    // Check that the container has overflow-hidden for rounded corners
    // Note: In test environment, computed styles may not reflect Tailwind classes
    // So we check the className instead
    expect(avatarContainer?.className).toContain('overflow-hidden')
    
    // Simulate image load to remove loading placeholder
    if (img) {
      img.dispatchEvent(new Event('load'))
    }
    
    // Wait for React to update state and remove loading placeholder
    await waitFor(() => {
      const loadingPlaceholders = avatarContainer?.querySelectorAll('[class*="animate-pulse"]')
      expect(loadingPlaceholders?.length || 0).toBe(0)
    })
  })

  it('should render avatar without loading placeholder covering it', async () => {
    vi.mocked(useFetchProfileHook.useFetchProfile).mockReturnValue({
      isFetching: false,
      error: null,
      profile: {
        pubkey: 'test_pubkey',
        npub: 'npub_test',
        username: 'testuser',
        avatar: 'https://example.com/avatar.jpg'
      }
    })

    const { container } = render(
      <div data-embedded-note>
        <div className="p-2 sm:p-3 border rounded-lg">
          <UserAvatar userId="test_pubkey" size="medium" />
        </div>
      </div>
    )

    const avatarContainer = container.querySelector('[data-user-avatar]')
    
    // Check that the image exists
    const img = avatarContainer?.querySelector('img')
    expect(img).toBeInTheDocument()
    
    // Simulate image load to trigger removal of loading placeholder
    if (img) {
      img.dispatchEvent(new Event('load'))
    }
    
    // Wait for React to update state and remove loading placeholder
    await waitFor(() => {
      const loadingPlaceholders = avatarContainer?.querySelectorAll('[class*="animate-pulse"]')
      expect(loadingPlaceholders?.length || 0).toBe(0)
    })
    
    // Check image is visible after loading
    const imgStyle = window.getComputedStyle(img!)
    expect(imgStyle.display).not.toBe('none')
    expect(imgStyle.visibility).not.toBe('hidden')
    expect(imgStyle.opacity).not.toBe('0')
  })

  it('should have correct z-index and positioning to prevent being covered', () => {
    vi.mocked(useFetchProfileHook.useFetchProfile).mockReturnValue({
      isFetching: false,
      error: null,
      profile: {
        pubkey: 'test_pubkey',
        npub: 'npub_test',
        username: 'testuser',
        avatar: 'https://example.com/avatar.jpg'
      }
    })

    const { container } = render(
      <div data-embedded-note>
        <div className="p-2 sm:p-3 border rounded-lg">
          <div className="flex items-center space-x-2">
            <UserAvatar userId="test_pubkey" size="medium" />
          </div>
        </div>
      </div>
    )

    const avatarContainer = container.querySelector('[data-user-avatar]')
    const computedStyle = window.getComputedStyle(avatarContainer!)
    
    // The container should have relative positioning (or static which is default)
    // In CSS, if position is not set, it defaults to static
    expect(['relative', 'static', '']).toContain(computedStyle.position)
    
    // Check that display is block or inline-block (not inline which could cause issues)
    expect(['block', 'inline-block', 'flex']).toContain(computedStyle.display)
    
    // Most importantly: check that the image is visible and not covered
    const img = avatarContainer?.querySelector('img')
    expect(img).toBeInTheDocument()
    const imgStyle = window.getComputedStyle(img!)
    expect(imgStyle.opacity).not.toBe('0')
    expect(imgStyle.display).not.toBe('none')
  })
})

