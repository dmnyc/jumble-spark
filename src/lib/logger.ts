/**
 * Centralized logging utility.
 *
 * Level matrix:
 *   dev + debug flag  → debug / info / warn / error  (full formatted output)
 *   dev (no flag)     → info / warn / error           (formatted, no stack)
 *   production        → warn / error only             (bare console — no timestamp string built)
 *
 * Enable debug in dev: localStorage.setItem('jumble-debug', 'true') then reload.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

class Logger {
  private readonly isDev = import.meta.env.DEV
  private enableDebug: boolean
  private minLevel: LogLevel

  constructor() {
    this.enableDebug =
      this.isDev &&
      (localStorage.getItem('imwald-debug') === 'true' ||
        localStorage.getItem('jumble-debug') === 'true' ||
        import.meta.env.VITE_DEBUG === 'true')

    // In production only warn/error reach the console — info is noise for end-users.
    this.minLevel = this.enableDebug ? 'debug' : this.isDev ? 'info' : 'warn'
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS.indexOf(level) >= LEVELS.indexOf(this.minLevel)
  }

  private getCallerInfo(): string {
    const stack = new Error().stack
    if (!stack) return 'unknown'
    for (const line of stack.split('\n').slice(3)) {
      const m = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/)
      if (m) {
        const fileName = m[2].split('/').pop()?.replace(/\.[tj]sx?$/, '') ?? 'unknown'
        return `${fileName}:${m[1]}`
      }
    }
    return 'unknown'
  }

  private prefix(level: LogLevel): string {
    const ts = new Date().toISOString().substring(11, 23)
    const caller = this.enableDebug ? ` [${this.getCallerInfo()}]` : ''
    return `[${ts}] [${level.toUpperCase()}]${caller}`
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this.enableDebug) return
    console.log(`${this.prefix('debug')} ${message}`, ...args)
  }

  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('info')) return
    // In production this branch is never reached (minLevel === 'warn').
    console.log(`${this.prefix('info')} ${message}`, ...args)
  }

  warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('warn')) return
    if (this.isDev) {
      console.warn(`${this.prefix('warn')} ${message}`, ...args)
    } else {
      // In production: no string-building overhead; browser devtools add their own timestamp.
      console.warn(message, ...args)
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('error')) return
    if (this.isDev) {
      console.error(`${this.prefix('error')} ${message}`, ...args)
    } else {
      console.error(message, ...args)
    }
  }

  /** Dev-only performance marker. */
  perf(message: string, ...args: unknown[]): void {
    if (!this.isDev) return
    console.log(`[PERF] ${message}`, ...args)
  }

  /** Run `fn` inside a console group (debug mode only). */
  group(label: string, fn: () => void): void {
    if (!this.enableDebug) { fn(); return }
    console.group(label)
    fn()
    console.groupEnd()
  }

  /** Raw dev-only log — no formatting. */
  dev(message: string, ...args: unknown[]): void {
    if (this.isDev) console.log(message, ...args)
  }

  setDebugMode(enabled: boolean): void {
    this.enableDebug = enabled
    this.minLevel = enabled ? 'debug' : this.isDev ? 'info' : 'warn'
    localStorage.setItem('imwald-debug', String(enabled))
    localStorage.setItem('jumble-debug', String(enabled))
  }

  isDebugEnabled(): boolean {
    return this.enableDebug
  }

  /** Component-scoped debug log (debug mode only). */
  component(componentName: string, message: string, ...args: unknown[]): void {
    if (!this.enableDebug) return
    console.log(`${this.prefix('debug')} [${componentName}] ${message}`, ...args)
  }

  /** Component-scoped perf log (dev only). */
  perfComponent(componentName: string, operation: string, ...args: unknown[]): void {
    if (!this.isDev) return
    console.log(`[PERF] [${componentName}] ${operation}`, ...args)
  }
}

// Create singleton instance
const logger = new Logger()

// Expose debug toggle for development
if (import.meta.env.DEV) {
  ;(window as any).imwaldLogger = logger
  ;(window as any).jumbleLogger = logger
}

export default logger
