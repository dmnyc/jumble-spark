import { simplifyUrl } from '@/lib/url'
import { TDraftEvent, TMediaUploadServiceConfig } from '@/types'
import { BlossomClient } from 'blossom-client-sdk'
import { z } from 'zod'
import client from './client.service'
import storage from './local-storage.service'

type UploadOptions = {
  onProgress?: (progressPercent: number) => void
  signal?: AbortSignal
}

export const UPLOAD_ABORTED_ERROR_MSG = 'Upload aborted'

class MediaUploadService {
  static instance: MediaUploadService

  private serviceConfig: TMediaUploadServiceConfig = storage.getMediaUploadServiceConfig()
  private nip96ServiceUploadUrlMap = new Map<string, string | undefined>()
  private imetaTagMap = new Map<string, string[]>()

  constructor() {
    if (!MediaUploadService.instance) {
      MediaUploadService.instance = this
    }
    return MediaUploadService.instance
  }

  setServiceConfig(config: TMediaUploadServiceConfig) {
    this.serviceConfig = config
  }

  async upload(file: File, options?: UploadOptions) {
    let result: { url: string; tags: string[][] }
    if (this.serviceConfig.type === 'nip96') {
      result = await this.uploadByNip96(this.serviceConfig.service, file, options)
    } else {
      result = await this.uploadByBlossom(file, options)
    }

    if (result.tags.length > 0) {
      this.imetaTagMap.set(result.url, ['imeta', ...result.tags.map(([n, v]) => `${n} ${v}`)])
    }
    return result
  }

  private async uploadByBlossom(file: File, options?: UploadOptions) {
    const pubkey = client.pubkey
    const signer = async (draft: TDraftEvent) => {
      if (!client.signer) {
        throw new Error('You need to be logged in to upload media')
      }
      return client.signer.signEvent(draft)
    }
    if (!pubkey) {
      throw new Error('You need to be logged in to upload media')
    }

    if (options?.signal?.aborted) {
      throw new Error(UPLOAD_ABORTED_ERROR_MSG)
    }

    options?.onProgress?.(0)

    // Pseudo-progress: advance gradually until main upload completes
    let pseudoProgress = 1
    let pseudoTimer: number | undefined
    const startPseudoProgress = () => {
      if (pseudoTimer !== undefined) return
      pseudoTimer = window.setInterval(() => {
        // Cap pseudo progress to 90% until we get real completion
        pseudoProgress = Math.min(pseudoProgress + 3, 90)
        options?.onProgress?.(pseudoProgress)
        if (pseudoProgress >= 90) {
          stopPseudoProgress()
        }
      }, 300)
    }
    const stopPseudoProgress = () => {
      if (pseudoTimer !== undefined) {
        clearInterval(pseudoTimer)
        pseudoTimer = undefined
      }
    }
    startPseudoProgress()

    const servers = await client.fetchBlossomServerList(pubkey)
    if (servers.length === 0) {
      throw new Error('No Blossom services available')
    }
    const [mainServer, ...mirrorServers] = servers

    const auth = await BlossomClient.createUploadAuth(signer, file, {
      message: 'Uploading media file'
    })

    // first upload blob to main server
    const blob = await BlossomClient.uploadBlob(mainServer, file, { auth })
    // Main upload finished
    stopPseudoProgress()
    options?.onProgress?.(80)

    if (mirrorServers.length > 0) {
      await Promise.allSettled(
        mirrorServers.map((server) => BlossomClient.mirrorBlob(server, blob, { auth }))
      )
    }

    let tags: string[][] = []
    const parseResult = z.array(z.array(z.string())).safeParse((blob as any).nip94 ?? [])
    if (parseResult.success) {
      tags = parseResult.data
    }

    options?.onProgress?.(100)
    return { url: blob.url, tags }
  }

  private async uploadByNip96(service: string, file: File, options?: UploadOptions) {
    if (options?.signal?.aborted) {
      throw new Error(UPLOAD_ABORTED_ERROR_MSG)
    }
    let uploadUrl = this.nip96ServiceUploadUrlMap.get(service)
    if (!uploadUrl) {
      const response = await fetch(`${service}/.well-known/nostr/nip96.json`)
      if (!response.ok) {
        throw new Error(
          `${simplifyUrl(service)} does not work, please try another service in your settings`
        )
      }
      const data = await response.json()
      uploadUrl = data?.api_url
      if (!uploadUrl) {
        throw new Error(
          `${simplifyUrl(service)} does not work, please try another service in your settings`
        )
      }
      this.nip96ServiceUploadUrlMap.set(service, uploadUrl)
    }

    if (options?.signal?.aborted) {
      throw new Error(UPLOAD_ABORTED_ERROR_MSG)
    }
    const formData = new FormData()
    formData.append('file', file)

    const auth = await client.signHttpAuth(uploadUrl, 'POST', 'Uploading media file')

    // Check if service worker might be interfering
    const hasServiceWorker = 'serviceWorker' in navigator && navigator.serviceWorker.controller
    const isFirefoxMobile = /Firefox/i.test(navigator.userAgent) && /Mobile/i.test(navigator.userAgent)
    
    if (hasServiceWorker) {
      console.warn('⚠️ Service worker is active - this may interfere with uploads on mobile', { uploadUrl, isFirefoxMobile })
    }

    // For Firefox mobile, add a cache-busting parameter to help bypass service worker
    // Also add a timestamp to ensure the request is unique
    let finalUploadUrl = uploadUrl as string
    if (isFirefoxMobile && hasServiceWorker) {
      const separator = finalUploadUrl.includes('?') ? '&' : '?'
      finalUploadUrl = `${finalUploadUrl}${separator}_nocache=${Date.now()}&_bypass_sw=1`
      console.log('🔧 Firefox mobile: Added cache-busting parameters to upload URL', { finalUploadUrl })
    }

    // Use XMLHttpRequest for upload progress support
    // Note: XMLHttpRequest should bypass service workers, but on mobile Firefox this isn't always reliable
    // We add cache-busting parameters for Firefox mobile to help bypass service worker
    const result = await new Promise<{ url: string; tags: string[][] }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', finalUploadUrl, true) // async=true to ensure it's not cached
      xhr.responseType = 'json'
      xhr.setRequestHeader('Authorization', auth)
      // Add headers to prevent caching on Firefox mobile
      if (isFirefoxMobile) {
        xhr.setRequestHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
        xhr.setRequestHeader('Pragma', 'no-cache')
        xhr.setRequestHeader('Expires', '0')
      }
      
      // Log upload start for debugging
      console.log('📤 Starting upload', { 
        uploadUrl, 
        fileSize: file.size, 
        fileType: file.type,
        fileName: file.name,
        hasServiceWorker,
        userAgent: navigator.userAgent
      })
      
      // Set a timeout (60 seconds for uploads)
      xhr.timeout = 60000
      
      // Track if we've already handled the response to avoid double handling
      let isHandled = false
      
      const handleError = (error: Error | string) => {
        if (isHandled) return
        isHandled = true
        const errorMessage = error instanceof Error ? error.message : error
        reject(new Error(errorMessage))
      }
      
      const handleAbort = () => {
        if (isHandled) return
        isHandled = true
        try {
          xhr.abort()
        } catch {
          // ignore
        }
        reject(new Error(UPLOAD_ABORTED_ERROR_MSG))
      }
      
      if (options?.signal) {
        if (options.signal.aborted) {
          return handleAbort()
        }
        options.signal.addEventListener('abort', handleAbort, { once: true })
      }
      
      // Handle timeout
      xhr.ontimeout = () => {
        console.error('⏱️ Upload timeout', { uploadUrl, fileSize: file.size })
        handleError('Upload timeout - the connection took too long. Please check your network connection and try again.')
      }
      
      // Handle abort
      xhr.onabort = () => {
        if (!isHandled) {
          isHandled = true
          reject(new Error(UPLOAD_ABORTED_ERROR_MSG))
        }
      }
      
      // Handle network errors
      xhr.onerror = () => {
        // Try to get more details about the error
        // Status 0 can mean: CORS failure, network error, service worker blocking, or connection refused
        let errorMessage = 'Network error'
        if (xhr.status === 0) {
          // On mobile, status 0 often means CORS or service worker issue, not necessarily connection failure
          if (isFirefoxMobile) {
            errorMessage = 'Upload failed on Firefox mobile - this is often due to a service worker issue. Try: 1) Refreshing the page, 2) Clearing browser cache, or 3) Disabling service workers in Firefox settings.'
          } else {
            errorMessage = 'Upload failed - this may be due to a service worker or CORS issue. Please try refreshing the page or clearing your browser cache.'
          }
        } else if (xhr.status >= 400) {
          errorMessage = `Upload failed with status ${xhr.status}: ${xhr.statusText || 'Unknown error'}`
        }
        console.error('❌ Upload network error', { 
          uploadUrl, 
          status: xhr.status, 
          statusText: xhr.statusText,
          readyState: xhr.readyState,
          fileSize: file.size,
          errorMessage 
        })
        handleError(errorMessage)
      }
      
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100)
          console.log('📊 Upload progress', { percent, loaded: event.loaded, total: event.total })
          options?.onProgress?.(percent)
        }
      }
      
      xhr.onload = () => {
        if (isHandled) return
        
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = xhr.response
            // Handle case where response might be a string that needs parsing
            let parsedData = data
            if (typeof data === 'string') {
              try {
                parsedData = JSON.parse(data)
              } catch {
                handleError('Invalid response format from upload server')
                return
              }
            }
            
            const tags = z.array(z.array(z.string())).parse(parsedData?.nip94_event?.tags ?? [])
            const url = tags.find(([tagName]: string[]) => tagName === 'url')?.[1]
            if (url) {
              console.log('✅ Upload successful', { url, uploadUrl })
              isHandled = true
              resolve({ url, tags })
            } else {
              console.error('❌ No URL in upload response', { parsedData, tags })
              handleError('No url found in upload response')
            }
          } catch (e) {
            handleError(e instanceof Error ? e : new Error('Failed to parse upload response'))
          }
        } else {
          handleError(`Upload failed with status ${xhr.status}: ${xhr.statusText || 'Unknown error'}`)
        }
      }
      
      try {
        xhr.send(formData)
      } catch (error) {
        handleError(error instanceof Error ? error : new Error('Failed to send upload request'))
      }
    })

    return result
  }

  getImetaTagByUrl(url: string) {
    return this.imetaTagMap.get(url)
  }
}

const instance = new MediaUploadService()
export default instance
