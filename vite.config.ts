import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import path from 'path'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'
import packageJson from './package.json'
/// <reference types="vitest" />

const getGitHash = () => {
  try {
    return JSON.stringify(execSync('git rev-parse --short HEAD').toString().trim())
  } catch (error) {
    console.warn('Failed to retrieve commit hash:', error)
    return '"unknown"'
  }
}

const getAppVersion = () => {
  try {
    return JSON.stringify(packageJson.version)
  } catch (error) {
    console.warn('Failed to retrieve app version:', error)
    return '"unknown"'
  }
}

/**
 * React Fast Refresh can remount provider children without matching context after editing providers
 * or pages. Full page reload keeps the tree consistent. `nostr-context.tsx` fixes duplicate Nostr
 * `createContext` identity across HMR for most cases.
 */
function fullReloadOnProvidersAndPages(): Plugin {
  return {
    name: 'full-reload-providers-pages',
    apply: 'serve',
    handleHotUpdate({ file, server }) {
      const normalized = file.replace(/\\/g, '/')
      if (normalized.includes('/src/providers/') || normalized.includes('/src/pages/')) {
        server.ws.send({ type: 'full-reload' })
        return []
      }
    }
  }
}

/**
 * Default proxy logs one multiline error + stack per failed request when the index relay is down.
 * Throttle to one hint: match `/api/events` paths (dev-index-relay), not other proxies like `/sites`.
 */
function quietDevIndexRelayProxyErrors(devIndexRelayTarget: string): Plugin {
  let lastSuppressedLog = 0
  const COOLDOWN_MS = 60_000

  return {
    name: 'quiet-dev-index-relay-proxy-errors',
    apply: 'serve',
    configResolved(config) {
      const prevError = config.logger.error.bind(config.logger)
      config.logger.error = (msg, options) => {
        const text = typeof msg === 'string' ? msg : ''
        if (
          text.includes('http proxy error') &&
          text.includes('ECONNREFUSED') &&
          text.includes('/api/events')
        ) {
          const now = Date.now()
          if (now - lastSuppressedLog >= COOLDOWN_MS) {
            lastSuppressedLog = now
            config.logger.warn(
              `[vite] Dev index relay not reachable (${devIndexRelayTarget}). Start it or set VITE_DEV_INDEX_RELAY_TARGET. Suppressing duplicate proxy errors for ${COOLDOWN_MS / 1000}s.`
            )
          }
          return
        }
        prevError(msg, options)
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `.env.local` is not on `process.env` when this file is evaluated unless we load it.
  const env = loadEnv(mode, process.cwd(), '')
  const devIndexRelayTarget =
    env.VITE_DEV_INDEX_RELAY_TARGET?.trim() || 'http://127.0.0.1:4000'

  return {
    base: '/',
    define: {
      'import.meta.env.GIT_COMMIT': getGitHash(),
      'import.meta.env.APP_VERSION': getAppVersion()
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    server: {
      // OG/link preview uses `/sites/?url=…`. Without this, Vite serves `index.html` and WebService parses the app shell.
      // Run the scraper on 8090 per PROXY_SETUP.md, or rely on allorigins fallback in dev (web.service.ts).
      proxy: {
        // Read-aloud Piper: same path as production Apache → aitherboard (avoid cross-origin CORS in dev).
        '/api/piper-tts': {
          target: 'http://127.0.0.1:9876',
          changeOrigin: true
        },
        '/sites': {
          target: 'http://127.0.0.1:8090',
          changeOrigin: true
        },
        // Loopback HTTP index relay: `import.meta.env.DEV` rewrites kind 10243 URLs through this path.
        '/dev-index-relay': {
          target: devIndexRelayTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/dev-index-relay/, '') || '/'
        }
      }
    },
    build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/')

          // One chunk per locale file — `i18n/index` statically imports all of them; splitting keeps
          // the main app chunk smaller and allows parallel fetch + finer cache invalidation.
          const localeMatch = norm.match(/\/i18n\/locales\/([^/]+)\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/)
          if (localeMatch) {
            const code = localeMatch[1].replace(/[^a-zA-Z0-9_-]/g, '_')
            return `i18n-locale-${code}`
          }

          if (!norm.includes('node_modules')) return undefined

          // Lazy-loaded only — must not share a chunk with sync vendors or it gets preloaded
          if (norm.includes('@asciidoctor')) {
            return 'vendor-asciidoctor'
          }

          if (norm.includes('/katex/') || norm.includes('node_modules/katex/')) {
            return 'vendor-katex'
          }

          // React core (load first; keep together)
          if (/node_modules\/(react-dom|react\/|scheduler\/|use-sync-external-store\/)/.test(norm)) {
            return 'vendor-react'
          }

          // ProseMirror vs TipTap — avoids one ~750k editor blob; both load together when editor mounts
          if (norm.includes('prosemirror-')) {
            return 'vendor-prosemirror'
          }
          if (norm.includes('@tiptap')) {
            return 'vendor-tiptap'
          }

          // Radix UI primitives
          if (norm.includes('@radix-ui')) {
            return 'vendor-radix'
          }

          // Nostr + crypto used by the stack
          if (
            norm.includes('nostr-tools') ||
            norm.includes('@noble') ||
            norm.includes('@scure')
          ) {
            return 'vendor-nostr'
          }

          if (norm.includes('lucide-react')) {
            return 'vendor-lucide'
          }

          if (norm.includes('i18next') || norm.includes('react-i18next')) {
            return 'vendor-i18n-runtime'
          }

          if (norm.includes('@dnd-kit')) {
            return 'vendor-dnd'
          }

          if (norm.includes('highlight.js') || norm.includes('/src/lib/highlight')) {
            return 'vendor-highlight'
          }

          if (norm.includes('flexsearch')) {
            return 'vendor-flexsearch'
          }

          if (norm.includes('emoji-picker-element')) {
            return 'vendor-emoji'
          }

          if (norm.includes('yet-another-react-lightbox')) {
            return 'vendor-lightbox'
          }

          if (norm.includes('@getalby') || norm.includes('bitcoin-connect')) {
            return 'vendor-lightning-alby'
          }
          if (norm.includes('nstart-modal')) {
            return 'vendor-lightning-nstart'
          }

          if (norm.includes('embla-carousel')) {
            return 'vendor-embla'
          }

          if (norm.includes('qr-code-styling') || norm.includes('/qr-scanner/')) {
            return 'vendor-qr'
          }

          if (norm.includes('/cmdk/')) {
            return 'vendor-cmdk'
          }

          if (norm.includes('/vaul/')) {
            return 'vendor-vaul'
          }

          if (norm.includes('tippy.js')) {
            return 'vendor-tippy'
          }

          if (norm.includes('/zod/') || norm.includes('node_modules/zod')) {
            return 'vendor-zod'
          }

          if (norm.includes('/dayjs/')) {
            return 'vendor-dayjs'
          }

          if (norm.includes('/sonner/')) {
            return 'vendor-sonner'
          }

          if (norm.includes('blossom-client-sdk')) {
            return 'vendor-blossom'
          }

          if (norm.includes('@popperjs')) {
            return 'vendor-popper'
          }

          if (norm.includes('@floating-ui')) {
            return 'vendor-floating-ui'
          }

          if (norm.includes('/blurhash/') || norm.includes('node_modules/blurhash')) {
            return 'vendor-blurhash'
          }

          if (norm.includes('/dataloader/') || norm.includes('node_modules/dataloader')) {
            return 'vendor-dataloader'
          }

          if (
            norm.includes('tailwind-merge') ||
            norm.includes('/clsx/') ||
            norm.includes('class-variance-authority')
          ) {
            return 'vendor-clsx-tailwind'
          }

          return 'vendor-misc'
        }
      },
      onwarn(warning, warn) {
        // Suppress vite:reporter warnings about mixed static/dynamic imports
        // These are informational warnings about code splitting, not errors
        if (warning.plugin === 'vite:reporter' && warning.message.includes('dynamically imported') && warning.message.includes('statically imported')) {
          return
        }
        // Use default warning handler for other warnings
        warn(warning)
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  },
  plugins: [
    react(),
    fullReloadOnProvidersAndPages(),
    quietDevIndexRelayProxyErrors(devIndexRelayTarget),
    VitePWA({
      registerType: 'autoUpdate',
      // Use public/manifest.webmanifest and index.html <link> only; avoid duplicate manifest link in build
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,jpg,svg,ico,webmanifest}'],
        globDirectory: 'dist/',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/_/, /^\/admin/],
        // Exclude source files and development files from precaching
        globIgnores: [
          '**/src/**',
          '**/node_modules/**',
          '**/*.map',
          '**/sw.js',
          '**/workbox-*.js'
        ],
        runtimeCaching: [
          {
            // Exclude upload endpoints from service worker handling - use NetworkOnly to bypass cache
            // Match various upload URL patterns - comprehensive regex to catch all upload services
            // This ensures uploads (POST) and discovery endpoints (GET) bypass the service worker
            // Note: XMLHttpRequest should bypass service workers, but we add this as a safety measure
            urlPattern: ({ url, request }) => {
              const urlString = url.toString()
              const method = request.method?.toUpperCase() || 'GET'
              
              // Always bypass service worker for POST requests (uploads)
              if (method === 'POST') {
                return /(?:api\/v2\/nip96\/upload|\.well-known\/nostr\/nip96\.json|nostr\.build|nostrcheck\.me|void\.cat|\/upload|\/nip96\/)/i.test(urlString)
              }
              
              // Also bypass for GET requests to upload-related endpoints
              return /(?:\.well-known\/nostr\/nip96\.json|api\/v2\/nip96\/upload)/i.test(urlString)
            },
            handler: 'NetworkOnly'
          },
          {
            // Well-known nostr media CDNs: cache aggressively since content is addressed by hash
            urlPattern:
              /^https:\/\/(?:image\.nostr\.build|cdn\.satellite\.earth|nostrimg\.com|void\.cat\/d|files\.sovbit\.host|cdn\.hzrd149\.com|blossom\.band|r2[a-z]?\.primal\.net)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'nostr-media-cdn',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 24 * 60 * 60 // 60 days — hash-addressed, effectively immutable
              },
              // Only cache genuine 200 OK responses; prevents opaque/error responses from
              // filling storage quota with unusable entries.
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            // Generic cross-origin images by file extension (covers hosts not matched above)
            urlPattern: /^https?:\/\/.+\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico)(?:\?.*)?$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'external-images',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 7 * 24 * 60 * 60 // 7 days
              },
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            // Audio files (podcasts, voice notes) — stale-while-revalidate so playback starts
            // immediately from cache while the network check runs in the background.
            urlPattern: /^https?:\/\/.+\.(?:mp3|ogg|opus|flac|m4a|aac|wav)(?:\?.*)?$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'external-audio',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 7 * 24 * 60 * 60 // 7 days
              },
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            // NIP-11 relay info documents: short-lived cache so relay metadata is fresh but
            // the app can render offline or on a slow connection without blocking on network.
            urlPattern: ({ request }: { request: Request }) =>
              request.headers.get('accept')?.includes('application/nostr+json') ?? false,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'nip11-relay-info',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 // 1 hour
              },
              cacheableResponse: { statuses: [200] }
            }
          }
        ]
      },
      devOptions: {
        // Disable in dev to avoid registerSW.js 404 → index.html returned → SyntaxError (expected expression, got '<')
        enabled: false,
        type: 'module'
      }
    })
  ]
  }
})
