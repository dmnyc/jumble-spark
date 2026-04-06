/**
 * Client-side image compression via the Canvas API.
 *
 * Called before every media upload to reduce bandwidth and server storage costs.
 * GIFs are returned unchanged (canvas flattens animation to a single frame).
 * Non-image files are returned unchanged.
 */

/** Longest edge cap before re-encoding. */
const MAX_DIMENSION_PX = 2048
/** Try WebP at this quality first — typically 30-50 % smaller than JPEG at same perceptual quality. */
const WEBP_QUALITY = 0.85
/** Starting JPEG quality; stepped down by 0.1 until the file fits. */
const JPEG_QUALITY_START = 0.82
/** Never go below this quality during progressive reduction. */
const JPEG_QUALITY_MIN = 0.35

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Compress `file` so the result is at most `targetMaxBytes`.
 *
 * Strategy:
 *  1. Down-scale to MAX_DIMENSION_PX on the longest edge.
 *  2. Encode as WebP at WEBP_QUALITY — usually the winner.
 *  3. If still too big, fall back to JPEG with progressive quality reduction.
 *  4. If nothing fits, return the best (smallest) result even if still over limit,
 *     unless it is bigger than the original — in which case return the original.
 */
export async function compressImage(file: File, targetMaxBytes: number): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/gif') return file // canvas strips animation
  if (file.type === 'image/svg+xml') return file
  if (file.size <= targetMaxBytes) return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }

  let { width, height } = bitmap
  if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
    const scale = Math.min(MAX_DIMENSION_PX / width, MAX_DIMENSION_PX / height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const baseName = file.name.replace(/\.[^.]+$/, '')

  // Try WebP first
  const webpBlob = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY)
  if (webpBlob && webpBlob.size <= targetMaxBytes) {
    return new File([webpBlob], `${baseName}.webp`, { type: 'image/webp' })
  }

  // Progressive JPEG quality reduction
  let bestBlob: Blob | null = webpBlob
  for (let q = JPEG_QUALITY_START; q >= JPEG_QUALITY_MIN; q = Math.round((q - 0.1) * 10) / 10) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', q)
    if (!blob) continue
    if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob
    if (blob.size <= targetMaxBytes) {
      return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
    }
  }

  // Return best effort result if it's at least smaller than the original
  if (bestBlob && bestBlob.size < file.size) {
    const isWebp = bestBlob.type === 'image/webp'
    return new File(
      [bestBlob],
      `${baseName}${isWebp ? '.webp' : '.jpg'}`,
      { type: bestBlob.type }
    )
  }

  return file
}
