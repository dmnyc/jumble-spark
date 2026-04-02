/**
 * Debug utilities for development and troubleshooting
 * 
 * Usage in browser console:
 * - imwaldDebug.enable() - Enable debug logging
 * - imwaldDebug.disable() - Disable debug logging
 * - imwaldDebug.status() - Check current debug status
 */

import logger from './logger'

interface DebugUtils {
  enable: () => void
  disable: () => void
  status: () => { enabled: boolean; level: string }
  log: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  perf: (message: string, ...args: any[]) => void
}

const debugUtils: DebugUtils = {
  enable: () => {
    logger.setDebugMode(true)
    logger.info('🔧 Imwald debug logging enabled')
  },
  
  disable: () => {
    logger.setDebugMode(false)
    logger.info('🔧 Imwald debug logging disabled')
  },
  
  status: () => {
    const enabled = logger.isDebugEnabled()
    logger.info(`🔧 Imwald debug status: ${enabled ? 'ENABLED' : 'DISABLED'}`)
    return { enabled, level: enabled ? 'debug' : 'info' }
  },
  
  log: (message: string, ...args: any[]) => {
    logger.debug(message, ...args)
  },
  
  warn: (message: string, ...args: any[]) => {
    logger.warn(message, ...args)
  },
  
  error: (message: string, ...args: any[]) => {
    logger.error(message, ...args)
  },
  
  perf: (message: string, ...args: any[]) => {
    logger.perf(message, ...args)
  }
}

// Expose debug utilities globally in development
if (import.meta.env.DEV) {
  ;(window as any).imwaldDebug = debugUtils
  ;(window as any).jumbleDebug = debugUtils
}

export default debugUtils
