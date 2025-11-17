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
  
  // Split by comma or semicolon to handle multiple references
  // Use a regex to split on commas/semicolons, but be careful with verse ranges like "1-3"
  // We'll split on commas/semicolons that are followed by a space and a capital letter (new book name)
  // or split on commas/semicolons that are not part of a verse range
  const parts: string[] = []
  let currentPart = ''
  let inVerseRange = false
  
  for (let i = 0; i < notation.length; i++) {
    const char = notation[i]
    const nextChar = notation[i + 1]
    
    if (char === '-' && /^\d/.test(currentPart.slice(-1))) {
      // This is part of a verse range (e.g., "1-3")
      inVerseRange = true
      currentPart += char
    } else if (char === ',' || char === ';') {
      // Check if this comma/semicolon is separating references
      // If the next non-whitespace character is a capital letter, it's likely a new book
      const rest = notation.substring(i + 1).trim()
      if (rest.length > 0 && /^[A-Z]/.test(rest)) {
        // This is separating references - save current part and start new one
        if (currentPart.trim()) {
          parts.push(currentPart.trim())
        }
        currentPart = ''
        inVerseRange = false
      } else {
        // This is part of the current reference (e.g., verse list "1,3,5")
        currentPart += char
        inVerseRange = false
      }
    } else {
      currentPart += char
      if (char === ' ' && inVerseRange) {
        inVerseRange = false
      }
    }
  }
  
  // Add the last part
  if (currentPart.trim()) {
    parts.push(currentPart.trim())
  }
  
  // If no splitting occurred, try simple split as fallback
  if (parts.length === 0) {
    parts.push(notation.trim())
  } else if (parts.length === 1 && (notation.includes(',') || notation.includes(';'))) {
    // Fallback: if we didn't split but there are commas/semicolons, try simple split
    // This handles cases like "Genesis 1:1,2,3" (verse list, not multiple references)
    const simpleParts = notation.split(/[,;]/).map(p => p.trim())
    if (simpleParts.length > 1) {
      // Check if these look like separate references (each has a book name)
      const looksLikeMultipleRefs = simpleParts.every(part => {
        // Check if part starts with a capital letter (likely a book name)
        return /^[A-Z]/.test(part.trim())
      })
      if (looksLikeMultipleRefs) {
        parts.length = 0
        parts.push(...simpleParts)
      }
    }
  }
  
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

