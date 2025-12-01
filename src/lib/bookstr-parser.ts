/**
 * Bookstr parsing utilities
 * Ported from wikistr/src/lib/books.ts for use in jumble
 */

export interface BookReference {
  book: string
  chapter?: number
  verse?: string // Can be "1", "1-3", "1,3,5", etc.
  version?: string
}

/**
 * Normalize string according to NIP-54 rules
 */
function normalizeNip54(text: string): string {
  return text
    .replace(/['"]/g, '') // Remove quotes
    .replace(/[^a-zA-Z0-9]/g, (char) => {
      if (/[a-zA-Z]/.test(char)) {
        return char.toLowerCase()
      }
      if (/[0-9]/.test(char)) {
        return char
      }
      return '-'
    })
    .toLowerCase()
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
}

/**
 * Parse book wikilink notation according to NKBIP-08
 * Format: "[[book::collection | title chapter:section | version]]"
 */
export function parseBookWikilink(wikilink: string): { references: BookReference[], versions?: string[], bookType?: string } | null {
  // Remove the [[ and ]] brackets
  const content = wikilink.replace(/^\[\[|\]\]$/g, '')
  
  // Must start with book::
  if (!content.startsWith('book::')) {
    return null
  }
  
  // Format: book::collection | title chapter:section | version
  const bookContent = content.substring(6).trim() // Remove "book::"
  
  // Split by pipes to parse structure
  const pipeParts = bookContent.split(/\s+\|\s+/)
  
  let collection: string | undefined
  let titlePart = ''
  let versionPart = ''
  
  if (pipeParts.length === 1) {
    // No pipes: just title (e.g., "book::genesis")
    titlePart = pipeParts[0]
  } else if (pipeParts.length === 2) {
    // One pipe: could be "collection | title" or "title chapter | version"
    const first = pipeParts[0].trim()
    const second = pipeParts[1].trim()
    
    // Check if first part has chapter/section (indicates it's title chapter | version)
    const hasChapterSection = first.match(/:\d+/) || first.match(/\s+\d+(\s|$)/)
    
    if (hasChapterSection) {
      // Format: "title chapter | version"
      titlePart = first
      versionPart = second
    } else {
      // Format: "collection | title"
      collection = normalizeNip54(first)
      titlePart = second
    }
  } else {
    // Multiple pipes: "collection | title chapter | version"
    collection = normalizeNip54(pipeParts[0].trim())
    titlePart = pipeParts.slice(1, -1).join(' | ')
    versionPart = pipeParts[pipeParts.length - 1].trim()
  }
  
  // Parse title, chapter, section from titlePart
  const chapterSectionMatch = titlePart.match(/^(.+?)\s+(\d+|[a-zA-Z0-9_-]+)(?::(.+))?$/)
  
  let title = ''
  let chapter: number | undefined
  let verse: string | undefined
  
  if (chapterSectionMatch) {
    title = normalizeNip54(chapterSectionMatch[1].trim())
    const chapterStr = chapterSectionMatch[2]
    chapter = /^\d+$/.test(chapterStr) ? parseInt(chapterStr, 10) : undefined
    if (chapterSectionMatch[3]) {
      verse = chapterSectionMatch[3].trim()
    }
  } else {
    title = normalizeNip54(titlePart)
  }
  
  // Parse versions
  const versions = versionPart ? versionPart.split(/\s+/).map(v => normalizeNip54(v).toUpperCase()).filter(v => v) : undefined
  
  // Use collection as bookType (e.g., "bible", "quran", "torah")
  // If no collection, default to "bible"
  const inferredBookType = collection || 'bible'
  
  // Create reference
  const reference: BookReference = {
    book: title
  }
  if (chapter !== undefined) {
    reference.chapter = chapter
  }
  if (verse) {
    reference.verse = verse
  }
  if (versions && versions.length > 0) {
    reference.version = versions[0] // Use first version for backward compatibility
  }
  
  return { references: [reference], versions, bookType: inferredBookType }
}

/**
 * Extract book metadata from event tags
 */
export function extractBookMetadata(event: { tags: string[][] }): {
  type?: string
  book?: string
  chapter?: string
  verse?: string
  version?: string
} {
  const metadata: any = {}
  
  for (const [tag, value] of event.tags) {
    switch (tag) {
      case 'type':
        metadata.type = value
        break
      case 'book':
        metadata.book = value
        break
      case 'chapter':
        metadata.chapter = value
        break
      case 'verse':
        metadata.verse = value
        break
      case 'version':
        metadata.version = value
        break
    }
  }
  
  return metadata
}

