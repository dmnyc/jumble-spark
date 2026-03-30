import { canonicalizeRssArticleUrl } from '@/lib/rss-article'

/**
 * NIP-B0: `d` tag is the URL without the scheme (`https://` / `http://` assumed).
 */
export function urlToWebBookmarkDTag(url: string): string {
  const t = url.trim()
  if (!t) return ''
  const withScheme =
    t.startsWith('http://') || t.startsWith('https://') ? canonicalizeRssArticleUrl(t) : `https://${t}`
  return withScheme.replace(/^https?:\/\//i, '')
}
