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
  // Strategy:
  // 1. First, try to intelligently split on commas/semicolons that are followed by a capital letter (new book)
  // 2. If that doesn't work, check if all parts start with capital letters (multiple references)
  // 3. Otherwise, treat as a single reference with verse lists
  
  // Step 1: Try intelligent splitting
  const parts: string[] = []
  let currentPart = ''
  
  for (let i = 0; i < notation.length; i++) {
    const char = notation[i]
    
    if (char === ',' || char === ';') {
      // Look ahead to see if this is separating references
      // Check if there's whitespace followed by a capital letter or number after this comma/semicolon
      // (Numbers handle cases like "1 John", "2 Corinthians")
      const afterComma = notation.substring(i + 1)
      const trimmedAfter = afterComma.trim()
      
      // If the next non-whitespace character is a capital letter or number, it's likely a new book reference
      if (trimmedAfter.length > 0 && /^[A-Z0-9]/.test(trimmedAfter)) {
        // This comma/semicolon is separating references
        if (currentPart.trim()) {
          parts.push(currentPart.trim())
        }
        currentPart = ''
      } else {
        // This comma/semicolon is part of the current reference (e.g., verse list "1,3,5")
        currentPart += char
      }
    } else {
      currentPart += char
    }
  }
  
  // Add the last part
  if (currentPart.trim()) {
    parts.push(currentPart.trim())
  }
  
  // Step 2: If we only got one part but there are commas/semicolons, try simple split
  if (parts.length === 1 && (notation.includes(',') || notation.includes(';'))) {
    const simpleParts = notation.split(/[,;]/).map(p => p.trim()).filter(p => p.length > 0)
    
    if (simpleParts.length > 1) {
      // Check if these look like separate references (each starts with a capital letter or number)
      // Numbers handle cases like "1 John", "2 Corinthians"
      const allStartWithCapitalOrNumber = simpleParts.every(part => {
        const trimmed = part.trim()
        return trimmed.length > 0 && /^[A-Z0-9]/.test(trimmed)
      })
      
      if (allStartWithCapitalOrNumber) {
        // These are multiple references
        parts.length = 0
        parts.push(...simpleParts)
      }
      // Otherwise, treat as a single reference with verse lists (e.g., "Genesis 1:1,2,3")
    }
  }
  
  // Step 3: Parse each part
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

