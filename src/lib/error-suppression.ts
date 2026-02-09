/**
 * Suppress expected console errors that are not actionable
 * This helps reduce noise in the development console
 */

// Track suppressed errors to avoid spam
const suppressedErrors = new Set<string>()

export function suppressExpectedErrors() {
  // Override console.error to filter out expected errors
  const originalConsoleError = console.error
  
  console.error = (...args: any[]) => {
    const message = args.join(' ')
    
    // Suppress favicon 404 errors
    if (message.includes('favicon.ico') && message.includes('404')) {
      return
    }
    
    // Suppress CORS errors for external websites
    if (message.includes('CORS policy') || 
        message.includes('Access-Control-Allow-Origin') ||
        message.includes('has been blocked by CORS policy') ||
        message.includes('blocked by CORS policy') ||
        (message.includes('Access to fetch at') && message.includes('has been blocked')) ||
        (message.includes('from origin') && message.includes('has been blocked'))) {
      return
    }
    
    // Suppress network errors for external websites (including CORS-related failures)
    // Suppress all ERR_FAILED errors as they're often CORS-related or expected failures
    if (message.includes('net::ERR_FAILED')) {
      return
    }
    
    // Suppress postMessage origin errors
    if (message.includes('Failed to execute \'postMessage\' on \'DOMWindow\'')) {
      return
    }
    
    // Suppress YouTube API warnings
    if (message.includes('Unrecognized feature: \'web-share\'')) {
      return
    }
    
    // Suppress Canvas2D warnings
    if (message.includes('Canvas2D: Multiple readback operations')) {
      return
    }
    
    // Suppress React "Maximum update depth exceeded" warnings
    // These are often caused by third-party libraries (e.g., Radix UI Popper)
    // where we cannot modify the source code directly
    if (message.includes('Maximum update depth exceeded')) {
      return
    }
    
    // Suppress Radix UI Dialog accessibility warnings
    // These are informational warnings about DialogTitle/Description
    // All our dialogs have titles (some hidden with sr-only for accessibility)
    if (message.includes('DialogContent') && (
      message.includes('requires a DialogTitle') ||
      message.includes('Missing `Description`') ||
      message.includes('aria-describedby')
    )) {
      return
    }
    
    // Suppress Workbox precaching errors for development modules
    if (message.includes('Precaching did not find a match') && (
      message.includes('@vite/client') ||
      message.includes('main.tsx') ||
      message.includes('src/') ||
      message.includes('node_modules/')
    )) {
      return
    }
    
    // Suppress "too many concurrent REQs" errors (handled by circuit breaker)
    if (message.includes('too many concurrent REQs')) {
      return
    }
    
    // Suppress relay overload errors (handled by throttling)
    if (message.includes('Relay overloaded - too many concurrent requests')) {
      return
    }
    
    // Suppress nostr-tools "too many concurrent REQs" errors
    if (message.includes('NOTICE from') && message.includes('ERROR: too many concurrent REQs')) {
      return
    }
    
    // Suppress nostr-tools connection errors
    if (message.includes('NOTICE from') && (
      message.includes('ERROR:') ||
      message.includes('connection closed') ||
      message.includes('connection errored')
    )) {
      return
    }
    
    // Suppress WebSocket connection errors
    if (message.includes('WebSocket connection to') || message.includes('failed:') || message.includes('Close received after close')) {
      return
    }
    
    // Suppress Ping timeout errors
    if (message.includes('Ping timeout')) {
      return
    }
    
    // Suppress invalid URL errors (often from empty or malformed relay URLs)
    if (message.includes('Invalid URL') || 
        message.includes('Failed to construct \'URL\'') ||
        (message.includes('wss://') && message.includes('Invalid')) ||
        (message.includes('ws://') && message.includes('Invalid'))) {
      return
    }
    
    // Suppress "unrecognised filter item" errors from relays
    if (message.includes('unrecognised filter item') || message.includes('unrecognized filter item')) {
      return
    }
    
    // Call original console.error for unexpected errors
    originalConsoleError.apply(console, args)
  }
  
  // Override console.warn to filter out expected warnings
  const originalConsoleWarn = console.warn
  
  console.warn = (...args: any[]) => {
    const message = args.join(' ')
    
    // Suppress React DevTools suggestion (only show once)
    if (message.includes('Download the React DevTools')) {
      if (suppressedErrors.has('react-devtools')) {
        return
      }
      suppressedErrors.add('react-devtools')
    }
    
    // Suppress Workbox warnings
    if (message.includes('workbox') && (
      message.includes('will not be cached') ||
      message.includes('Network request for') ||
      message.includes('returned a response with status')
    )) {
      return
    }
    
    // Suppress Canvas2D warnings (performance suggestions)
    if (message.includes('Canvas2D') || 
        message.includes('Multiple readback operations') ||
        message.includes('willReadFrequently') ||
        message.includes('getImageData')) {
      return
    }
    
    // Suppress CORS policy warnings
    if (message.includes('CORS policy') || 
        message.includes('Access-Control-Allow-Origin') ||
        message.includes('has been blocked by CORS policy') ||
        message.includes('blocked by CORS policy') ||
        (message.includes('Access to fetch') && message.includes('blocked')) ||
        (message.includes('from origin') && message.includes('blocked'))) {
      return
    }
    
    // Suppress network fetch errors that are expected (CORS, etc.)
    if (message.includes('Failed to fetch') || 
        message.includes('net::ERR_FAILED') ||
        (message.includes('GET ') && message.includes('blocked')) ||
        (message.includes('fetch') && message.includes('blocked'))) {
      return
    }
    
    // Suppress Radix UI Dialog accessibility warnings
    // These are informational warnings about DialogTitle/Description
    // All our dialogs have titles (some hidden with sr-only for accessibility)
    if (message.includes('DialogContent') && (
      message.includes('requires a DialogTitle') ||
      message.includes('Missing `Description`') ||
      message.includes('aria-describedby')
    )) {
      return
    }
    
    // Call original console.warn for unexpected warnings
    originalConsoleWarn.apply(console, args)
  }
  
  // Override console.log to filter out expected logs
  const originalConsoleLog = console.log
  
  console.log = (...args: any[]) => {
    const message = args.join(' ')
    
    // Suppress Workbox logs
    if (message.includes('workbox') || message.includes('[NoteStats]')) {
      return
    }
    
    // Suppress nostr-tools notices (ping, etc.)
    if (message.includes('NOTICE from')) {
      return
    }
    
    // Call original console.log for unexpected logs
    originalConsoleLog.apply(console, args)
  }
}

// Initialize error suppression
if (typeof window !== 'undefined') {
  suppressExpectedErrors()
}
