/**
 * Centralized logging utility to reduce console noise and improve performance
 * 
 * Usage:
 * - Use logger.debug() for development debugging (only shows in dev mode)
 * - Use logger.info() for important information (always shows)
 * - Use logger.warn() for warnings (always shows)
 * - Use logger.error() for errors (always shows)
 * 
 * In production builds, debug logs are completely removed to improve performance.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LoggerConfig {
  level: LogLevel
  enableDebug: boolean
  enablePerformance: boolean
}

class Logger {
  private config: LoggerConfig

  constructor() {
    // In production, disable debug logging for better performance
    const isDev = import.meta.env.DEV
    const isDebugEnabled = isDev && (localStorage.getItem('jumble-debug') === 'true' || import.meta.env.VITE_DEBUG === 'true')
    
    this.config = {
      level: isDebugEnabled ? 'debug' : 'info',
      enableDebug: isDebugEnabled,
      enablePerformance: isDev
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = ['debug', 'info', 'warn', 'error']
    const currentLevelIndex = levels.indexOf(this.config.level)
    const messageLevelIndex = levels.indexOf(level)
    return messageLevelIndex >= currentLevelIndex
  }

  private getCallerInfo(): string {
    const stack = new Error().stack
    if (!stack) return 'unknown'
    
    const lines = stack.split('\n')
    // Skip the first 3 lines (Error, getCallerInfo, formatMessage)
    // Look for the first line that contains a file path
    for (let i = 3; i < lines.length; i++) {
      const line = lines[i]
      const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/)
      if (match) {
        const [, functionName, filePath] = match
        const fileName = filePath.split('/').pop()?.replace('.tsx', '').replace('.ts', '') || 'unknown'
        return `${fileName}:${functionName}`
      }
    }
    return 'unknown'
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): [string, ...any[]] {
    const timestamp = new Date().toISOString().substring(11, 23) // HH:mm:ss.SSS
    // Stack capture is expensive (main-thread jank, especially on mobile). Only when deep debug is on.
    const caller = this.config.enableDebug ? this.getCallerInfo() : ''
    const prefix = caller
      ? `[${timestamp}] [${level.toUpperCase()}] [${caller}]`
      : `[${timestamp}] [${level.toUpperCase()}]`
    return [`${prefix} ${message}`, ...args]
  }

  debug(message: string, ...args: any[]): void {
    if (!this.config.enableDebug || !this.shouldLog('debug')) return
    console.log(...this.formatMessage('debug', message, ...args))
  }

  info(message: string, ...args: any[]): void {
    if (!this.shouldLog('info')) return
    console.log(...this.formatMessage('info', message, ...args))
  }

  warn(message: string, ...args: any[]): void {
    if (!this.shouldLog('warn')) return
    console.warn(...this.formatMessage('warn', message, ...args))
  }

  error(message: string, ...args: any[]): void {
    if (!this.shouldLog('error')) return
    console.error(...this.formatMessage('error', message, ...args))
  }

  // Performance logging for development
  perf(message: string, ...args: any[]): void {
    if (!this.config.enablePerformance) return
    console.log(`[PERF] ${message}`, ...args)
  }

  // Group logging for related operations
  group(label: string, fn: () => void): void {
    if (!this.config.enableDebug) {
      fn()
      return
    }
    console.group(label)
    fn()
    console.groupEnd()
  }

  // Conditional logging based on environment
  dev(message: string, ...args: any[]): void {
    if (import.meta.env.DEV) {
      console.log(message, ...args)
    }
  }

  // Enable/disable debug mode at runtime
  setDebugMode(enabled: boolean): void {
    this.config.enableDebug = enabled
    this.config.level = enabled ? 'debug' : 'info'
    localStorage.setItem('jumble-debug', enabled.toString())
  }

  // Check if debug mode is enabled
  isDebugEnabled(): boolean {
    return this.config.enableDebug
  }

  // Context-aware logging for components
  component(componentName: string, message: string, ...args: any[]): void {
    if (!this.config.enableDebug) return
    const timestamp = new Date().toISOString().substring(11, 23)
    const caller = this.getCallerInfo()
    console.log(`[${timestamp}] [COMPONENT] [${componentName}] [${caller}] ${message}`, ...args)
  }

  // Performance logging with context
  perfComponent(componentName: string, operation: string, ...args: any[]): void {
    if (!this.config.enablePerformance) return
    const timestamp = new Date().toISOString().substring(11, 23)
    const caller = this.getCallerInfo()
    console.log(`[${timestamp}] [PERF] [${componentName}] [${caller}] ${operation}`, ...args)
  }
}

// Create singleton instance
const logger = new Logger()

// Expose debug toggle for development
if (import.meta.env.DEV) {
  ;(window as any).jumbleLogger = logger
}

export default logger
