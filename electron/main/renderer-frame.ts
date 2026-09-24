export function isRendererFrameUrl(
  frameUrl: string | undefined,
  rendererOrigin: string | null
): boolean {
  if (!frameUrl || !rendererOrigin) return false

  try {
    const frame = new URL(frameUrl)
    const renderer = new URL(rendererOrigin)

    // WHATWG URL reports `null` for custom-scheme origins, even though
    // Electron treats app://renderer as a standard, secure origin.
    if (renderer.protocol === 'app:') {
      return frame.protocol === renderer.protocol && frame.host === renderer.host
    }

    return frame.origin === renderer.origin
  } catch {
    return false
  }
}
