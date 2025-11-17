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
 * Normalize whitespace and case in book reference strings
 */
function normalizeBookReferenceWhitespace(ref: string): string {
  let normalized = ref.trim()
  
  // Handle cases where there's no space between book name and chapter/verse
  normalized = normalized.replace(/^([A-Za-z]+)(\d+)/, '$1 $2')
  
  // Normalize multiple spaces to single spaces
  normalized = normalized.replace(/\s+/g, ' ')
  
  return normalized.trim()
}

/**
 * Parse book notation like "John 1–3; 3:16; 6:14, 44" for any book type
 * Returns an array of BookReference objects
 */
export function parseBookNotation(notation: string, bookType: string = 'bible'): BookReference[] {
  const references: BookReference[] = []
  
  // Split by semicolon to handle multiple references
  const parts = notation.split(';').map(p => p.trim())
  
  for (const part of parts) {
    const normalizedPart = normalizeBookReferenceWhitespace(part)
    const ref = parseSingleBookReference(normalizedPart, bookType)
    if (ref) {
      references.push(ref)
    }
  }
  
  return references
}

/**
 * Parse a single book reference like "John 3:16" or "John 1-3" or "John 3:16 KJV"
 */
function parseSingleBookReference(ref: string, _bookType: string = 'bible'): BookReference | null {
  // Remove extra whitespace
  ref = ref.trim()
  
  // First, try to extract version from the end
  let version: string | undefined
  let refWithoutVersion = ref
  
  // Common version abbreviations (can be extended)
  const versionPattern = /\s+(KJV|NKJV|NIV|ESV|NASB|NLT|MSG|CEV|NRSV|RSV|ASV|YLT|WEB|GNV|DRB|SAHIH|PICKTHALL|YUSUFALI|SHAKIR|CCC|YOUCAT|COMPENDIUM)$/i
  const versionMatch = ref.match(versionPattern)
  if (versionMatch) {
    version = versionMatch[1].toUpperCase()
    refWithoutVersion = ref.replace(versionPattern, '').trim()
  }
  
  // Match patterns
  const patterns = [
    // Book Chapter:Verses (e.g., "John 3:16", "John 3:16,18")
    /^(.+?)\s+(\d+):(.+)$/,
    // Book Chapter-Verses (e.g., "John 1-3", "John 1-3,5")
    /^(.+?)\s+(\d+)-(.+)$/,
    // Book Chapter (e.g., "John 3")
    /^(.+?)\s+(\d+)$/,
    // Just Book (e.g., "John")
    /^(.+)$/
  ]
  
  for (const pattern of patterns) {
    const match = refWithoutVersion.match(pattern)
    if (match) {
      const bookName = match[1].trim()
      
      const reference: BookReference = {
        book: bookName
      }
      
      if (match[2]) {
        reference.chapter = parseInt(match[2])
      }
      
      if (match[3]) {
        reference.verse = match[3]
      }
      
      if (version) {
        reference.version = version
      }
      
      return reference
    }
  }
  
  return null
}

/**
 * Parse book wikilink notation like "[[book:bible:John 3:16 | KJV]]" or "[[book:bible:John 3:16 | KJV DRB]]"
 */
export function parseBookWikilink(wikilink: string, bookType: string = 'bible'): { references: BookReference[], versions?: string[] } | null {
  // Remove the [[ and ]] brackets
  const content = wikilink.replace(/^\[\[|\]\]$/g, '')
  
  // Handle book: prefix (e.g., "book:bible:John 3:16")
  let referenceContent = content
  if (content.startsWith('book:')) {
    const parts = content.substring(5).split(':')
    if (parts.length >= 2) {
      bookType = parts[0]
      referenceContent = parts.slice(1).join(':')
    }
  } else if (content.startsWith('bible:')) {
    // Legacy Bible prefix support
    bookType = 'bible'
    referenceContent = content.substring(6).trim()
  }
  
  // Split by | to separate references from versions
  const parts = referenceContent.split('|').map(p => p.trim())
  
  if (parts.length === 0) return null
  
  // Normalize whitespace in the reference part
  const normalizedReference = normalizeBookReferenceWhitespace(parts[0])
  const references = parseBookNotation(normalizedReference, bookType)
  
  // Parse multiple versions if provided
  let versions: string[] | undefined
  if (parts[1]) {
    versions = parts[1].split(/\s+/).map(v => v.trim().toUpperCase()).filter(v => v.length > 0)
  }
  
  return { references, versions }
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

