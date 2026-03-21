import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import path from 'path'
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

// https://vite.dev/config/
export default defineConfig({
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          // Lazy-loaded only — must not share a chunk with sync vendors or it gets preloaded
          if (id.includes('@asciidoctor')) {
            return 'vendor-asciidoctor'
          }

          if (id.includes('/katex/') || id.includes('node_modules/katex/')) {
            return 'vendor-katex'
          }

          // React core (load first; keep together)
          if (/node_modules\/(react-dom|react\/|scheduler\/|use-sync-external-store\/)/.test(id)) {
            return 'vendor-react'
          }

          // TipTap + ProseMirror
          if (id.includes('@tiptap') || id.includes('prosemirror-')) {
            return 'vendor-editor'
          }

          // Radix UI primitives
          if (id.includes('@radix-ui')) {
            return 'vendor-radix'
          }

          // Nostr + crypto used by the stack
          if (
            id.includes('nostr-tools') ||
            id.includes('@noble') ||
            id.includes('@scure')
          ) {
            return 'vendor-nostr'
          }

          if (id.includes('lucide-react')) {
            return 'vendor-lucide'
          }

          if (id.includes('i18next') || id.includes('react-i18next')) {
            return 'vendor-i18n'
          }

          if (id.includes('@dnd-kit')) {
            return 'vendor-dnd'
          }

          if (id.includes('highlight.js')) {
            return 'vendor-highlight'
          }

          if (id.includes('flexsearch')) {
            return 'vendor-flexsearch'
          }

          if (id.includes('emoji-picker-react')) {
            return 'vendor-emoji'
          }

          if (id.includes('yet-another-react-lightbox')) {
            return 'vendor-lightbox'
          }

          if (
            id.includes('@getalby') ||
            id.includes('bitcoin-connect') ||
            id.includes('nstart-modal')
          ) {
            return 'vendor-lightning'
          }

          if (id.includes('embla-carousel')) {
            return 'vendor-embla'
          }

          if (id.includes('qr-code-styling') || id.includes('/qr-scanner/')) {
            return 'vendor-qr'
          }

          if (id.includes('/cmdk/')) {
            return 'vendor-cmdk'
          }

          if (id.includes('/vaul/')) {
            return 'vendor-vaul'
          }

          if (id.includes('tippy.js')) {
            return 'vendor-tippy'
          }

          if (id.includes('/zod/') || id.includes('node_modules/zod')) {
            return 'vendor-zod'
          }

          if (id.includes('/dayjs/')) {
            return 'vendor-dayjs'
          }

          if (id.includes('/sonner/')) {
            return 'vendor-sonner'
          }

          if (id.includes('blossom-client-sdk')) {
            return 'vendor-blossom'
          }

          if (id.includes('@popperjs')) {
            return 'vendor-popper'
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
            urlPattern: /^https:\/\/image\.nostr\.build\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'nostr-images',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
              }
            }
          },
          {
            urlPattern: /^https:\/\/cdn\.satellite\.earth\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'satellite-images',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
              }
            }
          },
          {
            urlPattern: /^https:\/\/.*\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'external-images',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 7 * 24 * 60 * 60 // 7 days
              }
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
})
