/**
 * Advanced search parser for Nostr events
 * Supports multiple search parameters:
 * - Hashtag: t:hashtag or hashtag:hashtag (filters by #t tag)
 * - Event IDs: Bare event IDs (hex, note1, nevent1, naddr1) work as standard search
 * - Plain text: becomes d-tag search for replaceable events (uses #d tag)
 * 
 * Note: 
 * - Nostr only supports single-letter tag indexes (#d, #t, #p, #e, #a, etc.)
 * - Kind filter is only available as URL parameter k= (e.g., ?t=bitcoin&k=1)
 * - Date searches and pubkey filters are not supported
 */

export interface AdvancedSearchParams {
  dtag?: string
  hashtag?: string | string[] // t-tag/hashtag (uses #t tag)
  title?: string | string[]
  subject?: string | string[]
  description?: string | string[]
  author?: string | string[]
  pubkey?: string | string[] // Accepts: hex, npub, nprofile, or NIP-05
  events?: string | string[] // Accepts: hex event ID, note, nevent, naddr (bare IDs work as standard search)
  type?: string | string[]
  // Date searches removed - not supported
  // Kind filter only available as URL parameter k=
}

/**
 * Normalize search term to d-tag format (lowercase, hyphenated)
 */
export function normalizeToDTag(term: string): string {
  return term
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
}

/**
 * Parse advanced search query
 */
export function parseAdvancedSearch(query: string): AdvancedSearchParams {
  // Normalize the query: trim, normalize whitespace, handle multiple spaces
  const normalizedQuery = query
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
    .replace(/\s*,\s*/g, ',') // Normalize spaces around commas
    .replace(/\s*:\s*/g, ':') // Normalize spaces around colons
  
  const params: AdvancedSearchParams = {}

  // Regular expressions for different parameter types
  // Note: Date searches, kind: prefix, and pubkey: prefix removed
  // Kind only available as URL parameter k=
  const quotedPattern = /(title|subject|description|author|type|hashtag|t):"([^"]+)"/gi
  const unquotedPattern = /(title|subject|description|author|type|hashtag|t):([^\s]+)/gi
  
  // Pattern to detect bare nip19 IDs (nevent, note, naddr) or hex event IDs
  // These start with the prefix and are base32 encoded (use word boundary to avoid partial matches)
  const bareEventIdPattern = /\b(nevent1|note1|naddr1)[a-z0-9]{0,58}\b/gi
  const hexEventIdPattern = /\b[a-f0-9]{64}\b/i
  
  // Pattern to detect bare pubkey IDs (npub, nprofile) or hex pubkeys
  const barePubkeyIdPattern = /\b(nprofile1|npub1)[a-z0-9]{0,58}\b/gi
  const nip05Pattern = /\b[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi

  // Extract quoted parameters
  let match
  let lastIndex = 0
  const usedIndices: number[] = []
  const detectedEventIds: { id: string; start: number; end: number }[] = []
  const detectedPubkeyIds: { id: string; start: number; end: number }[] = []

  // First, detect bare event IDs (nevent, note, naddr) in the normalized query
  bareEventIdPattern.lastIndex = 0
  while ((match = bareEventIdPattern.exec(normalizedQuery)) !== null) {
    const id = match[0]
    const start = match.index
    const end = start + id.length
    detectedEventIds.push({ id, start, end })
    usedIndices.push(start, end)
  }
  
  // Detect bare pubkey IDs (npub, nprofile)
  barePubkeyIdPattern.lastIndex = 0
  while ((match = barePubkeyIdPattern.exec(normalizedQuery)) !== null) {
    const id = match[0]
    const start = match.index
    const end = start + id.length
    detectedPubkeyIds.push({ id, start, end })
    usedIndices.push(start, end)
  }
  
  // Detect NIP-05 identifiers
  nip05Pattern.lastIndex = 0
  while ((match = nip05Pattern.exec(normalizedQuery)) !== null) {
    const id = match[0]
    const start = match.index
    const end = start + id.length
    
    // Skip if already used by a parameter pattern or other detected IDs
    if (!usedIndices.some((idx, i) => i % 2 === 0 && start >= idx && start <= usedIndices[i + 1])) {
      detectedPubkeyIds.push({ id, start, end })
      usedIndices.push(start, end)
    }
  }
  
  // Check for hex IDs (64 character hex string) - could be either event or pubkey
  // We'll treat them as events by default, but they might be interpreted differently in context
  hexEventIdPattern.lastIndex = 0
  while ((match = hexEventIdPattern.exec(normalizedQuery)) !== null) {
    const id = match[0]
    const start = match.index
    const end = start + id.length
    
    // Only add if not already in a detected ID range
    if (!usedIndices.some((idx, i) => i % 2 === 0 && start >= idx && start <= usedIndices[i + 1])) {
      // Default to treating as event ID (most common case for hex IDs in Nostr)
      detectedEventIds.push({ id, start, end })
      usedIndices.push(start, end)
    }
  }

  // Helper function to parse comma-separated values
  const parseValues = (value: string): string[] => {
    return value.split(',').map(v => v.trim()).filter(v => v.length > 0)
  }

  // Process quoted strings first (they can contain spaces)
  while ((match = quotedPattern.exec(normalizedQuery)) !== null) {
    const param = match[1].toLowerCase()
    const value = match[2]
    const start = match.index
    const end = start + match[0].length
    
    usedIndices.push(start, end)
    lastIndex = end

    const values = parseValues(value)
    switch (param) {
      case 'hashtag':
      case 't':
        params.hashtag = values.length === 1 ? values[0] : values
        break
      case 'title':
        params.title = values.length === 1 ? values[0] : values
        break
      case 'subject':
        params.subject = values.length === 1 ? values[0] : values
        break
      case 'description':
        params.description = values.length === 1 ? values[0] : values
        break
      case 'author':
        params.author = values.length === 1 ? values[0] : values
        break
      case 'type':
        params.type = values.length === 1 ? values[0] : values
        break
    }
  }

  // Process unquoted parameters
  while ((match = unquotedPattern.exec(normalizedQuery)) !== null) {
    const start = match.index
    // Skip if already used by quoted pattern
    if (usedIndices.some((idx, i) => i % 2 === 0 && start >= idx && start <= usedIndices[i + 1])) {
      continue
    }

    const param = match[1].toLowerCase()
    const value = match[2]
    const end = start + match[0].length

    usedIndices.push(start, end)
    lastIndex = Math.max(lastIndex, end)

    switch (param) {
      case 'hashtag':
      case 't':
        if (!params.hashtag) {
          const values = parseValues(value)
          params.hashtag = values.length === 1 ? values[0] : values
        }
        break
      case 'title':
        if (!params.title) {
          const values = parseValues(value)
          params.title = values.length === 1 ? values[0] : values
        }
        break
      case 'subject':
        if (!params.subject) {
          const values = parseValues(value)
          params.subject = values.length === 1 ? values[0] : values
        }
        break
      case 'description':
        if (!params.description) {
          const values = parseValues(value)
          params.description = values.length === 1 ? values[0] : values
        }
        break
      case 'author':
        if (!params.author) {
          const values = parseValues(value)
          params.author = values.length === 1 ? values[0] : values
        }
        break
      case 'type':
        if (!params.type) {
          const values = parseValues(value)
          params.type = values.length === 1 ? values[0] : values
        }
        break
    }
  }
  
  // Process detected bare event IDs (those not used as parameters)
  // Note: Bare event IDs are left as plain text for standard search, not stored as filter params
  for (const detectedId of detectedEventIds) {
    const start = detectedId.start
    // Skip if already used by a parameter pattern
    if (usedIndices.some((idx, i) => i % 2 === 0 && start >= idx && start <= usedIndices[i + 1])) {
      continue
    }
    
    // Mark as used - but don't store in params.events, leave as plain text for standard search
    usedIndices.push(start, detectedId.end)
  }
  
  // Process detected bare pubkey IDs (those not used as parameters)
  // Note: Pubkey filters removed - not supported
  for (const detectedId of detectedPubkeyIds) {
    const start = detectedId.start
    // Skip if already used by a parameter pattern
    if (usedIndices.some((idx, i) => i % 2 === 0 && start >= idx && start <= usedIndices[i + 1])) {
      continue
    }
    
    // Mark as used - but don't store in params.pubkey, leave as plain text
    usedIndices.push(start, detectedId.end)
  }

  // Date searches removed - not supported

  // Extract plain text (everything not matched by patterns)
  usedIndices.sort((a, b) => a - b)
  let plainText = ''
  let textStart = 0

  // Remove duplicate indices and merge overlapping ranges
  const ranges: Array<[number, number]> = []
  for (let i = 0; i < usedIndices.length; i += 2) {
    const start = usedIndices[i]
    const end = usedIndices[i + 1] || usedIndices[i]
    ranges.push([start, end])
  }
  
  // Sort and merge overlapping ranges
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    if (merged.length === 0 || merged[merged.length - 1][1] < range[0]) {
      merged.push(range)
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], range[1])
    }
  }

  // Extract plain text from gaps between used ranges
  for (const [start, end] of merged) {
    if (textStart < start) {
      const segment = normalizedQuery.substring(textStart, start).trim()
      if (segment) {
        plainText += (plainText ? ' ' : '') + segment
      }
    }
    textStart = Math.max(textStart, end)
  }

  // Add remaining text
  if (textStart < normalizedQuery.length) {
    const remaining = normalizedQuery.substring(textStart).trim()
    if (remaining) {
      plainText += (plainText ? ' ' : '') + remaining
    }
  }

  // If we have plain text and no other parameters, use it as d-tag
  if (plainText && !Object.keys(params).length) {
    params.dtag = normalizeToDTag(plainText)
  } else if (plainText) {
    // Plain text can also be used for d-tag even with other params
    params.dtag = normalizeToDTag(plainText)
  }

  return params
}

