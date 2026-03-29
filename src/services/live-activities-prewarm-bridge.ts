/**
 * Fired when {@link ClientService.runSessionPrewarm} finishes so the live-activities banner can refresh
 * in step with the initial session batch (logged-in or anonymous).
 */

let onPrewarmComplete: (() => void) | null = null

export function registerLiveActivitiesPrewarmCallback(fn: (() => void) | null): void {
  onPrewarmComplete = fn
}

export function notifyLiveActivitiesPrewarmComplete(): void {
  try {
    onPrewarmComplete?.()
  } catch {
    // ignore listener errors
  }
}
