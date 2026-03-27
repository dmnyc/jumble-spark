import { isImageUrl } from '@/lib/image-extraction'

export const POLL_OPTION_IMAGE_MAX_HEIGHT_PX = 200

export type TPollOptionImagePart = { url: string; alt: string }

/**
 * Split a poll `option` tag label into plain text and image URLs (markdown `![](url)` or bare https image links).
 */
export type TPollOptionVisualParts = {
  text: string
  images: TPollOptionImagePart[]
}

export function parsePollOptionVisualParts(label: string): TPollOptionVisualParts {
  const images: TPollOptionImagePart[] = []
  const seen = new Set<string>()

  const push = (url: string, alt: string) => {
    const u = url.trim()
    if (!u || seen.has(u)) return
    seen.add(u)
    images.push({ url: u, alt: alt.trim() })
  }

  let rest = label
  const mdRe = /!\[([^\]]*)\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = mdRe.exec(label)) !== null) {
    push(m[2] ?? '', m[1] ?? '')
  }
  rest = rest.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, ' ').replace(/\s+/g, ' ').trim()

  if (images.length === 0 && rest) {
    const single = rest.trim()
    if (!/\s/.test(single) && /^https?:\/\//i.test(single) && isImageUrl(single)) {
      return { text: '', images: [{ url: single, alt: '' }] }
    }
  }

  const tokens = rest.match(/https?:\/\/[^\s]+/gi) || []
  for (const t of tokens) {
    if (seen.has(t) || !isImageUrl(t)) continue
    push(t, '')
    rest = rest.split(t).join(' ')
  }

  rest = rest.replace(/\s+/g, ' ').trim()
  return { text: rest, images }
}
